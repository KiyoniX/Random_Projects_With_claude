// Les formats de fichiers des jeux Pokémon sur 3DS, lus dans le navigateur.
//
// Ce fichier pose window.FORMATS3DS, que la page de l'explorateur charge et que la visionneuse BCH
// charge aussi par <script src="../explorateur-romfs/formats.js">. Il n'a besoin de rien, ne touche
// pas au document et marche aussi sous Node (module.exports) pour les tests.
//
// GARC, LZ10/LZ11 et textes sont des portages fidèles des scripts Python de decompil-3ds/outils/
// (garc.py, lz11.py, texte.py), eux-mêmes tirés de pk3DS de kwsch :
//   https://github.com/kwsch/pk3DS  (pk3DS.Core/TextFile.cs, pk3DS.Core/Game/TextVariableCode.cs)
//
// Textures et BCLIM, d'après :
//   SPICA de gdkchan, SPICA/PICA/Converters/TextureConverter.cs (tuiles de 8 × 8, ordre de Morton,
//     ordre des octets de chaque format) et TextureCompression.cs (ETC1, ETC1A4) ;
//     https://github.com/gdkchan/SPICA
//   Ohana3DS-Rebirth de gdkchan, Ohana/Textures/BCLIM.cs (pied de page CLIM à 0x28 octets de la fin,
//     table des formats 0 à 12, décodage aux dimensions puissances de deux puis recadrage) ;
//     https://github.com/gdkchan/Ohana3DS-Rebirth
//   Citra, video_core/texture/etc1 (disposition des bits d'un bloc ETC1 lu en petit-boutiste) ;
//   3dbrew, pages « CLIM » et « GPU/Textures ».
// Le format 13 (A4) des BCLIM manque à Ohana ; on le prend dans la numérotation de 3dbrew.
//
// Le paquet « mini » de Game Freak (deux lettres, un nombre, une table de fins) est écrit de mémoire
// d'après pk3DS (CTR/Mini) : à vérifier sur le romfs.
(function (racine) {
  'use strict';

  // ---------------------------------------------------------------- outils communs

  function u16(o, p) { return o[p] | o[p + 1] << 8; }
  function u32(o, p) { return (o[p] | o[p + 1] << 8 | o[p + 2] << 16 | o[p + 3] << 24) >>> 0; }
  function hex(n, chiffres) { var s = n.toString(16).toUpperCase(); while (s.length < (chiffres || 0)) s = '0' + s; return s; }
  function verifierOctets(octets) {
    if (!(octets instanceof Uint8Array)) throw new Error('il faut un Uint8Array');
  }
  function Ecrivain() { this.buf = new Uint8Array(256); this.n = 0; }
  Ecrivain.prototype.place = function (k) {
    if (this.n + k <= this.buf.length) return;
    var b = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
    b.set(this.buf.subarray(0, this.n)); this.buf = b;
  };
  Ecrivain.prototype.u8 = function (v) { this.place(1); this.buf[this.n++] = v & 0xFF; };
  Ecrivain.prototype.u16 = function (v) { this.place(2); this.buf[this.n++] = v & 0xFF; this.buf[this.n++] = v >>> 8 & 0xFF; };
  Ecrivain.prototype.u32 = function (v) { this.place(4); for (var i = 0; i < 4; i++) this.buf[this.n++] = v >>> (8 * i) & 0xFF; };
  Ecrivain.prototype.octets = function (o) { this.place(o.length); this.buf.set(o, this.n); this.n += o.length; };
  Ecrivain.prototype.fin = function () { return this.buf.slice(0, this.n); };

  // ---------------------------------------------------------------- GARC (garc.py)
  // Les magics sont écrits à l'envers : « CRAG », « OTAF », « BTAF », « BMIF ».

  var MAGIC_GARC = 0x47415243, MAGIC_FATO = 0x4641544F, MAGIC_FATB = 0x46415442, MAGIC_FIMB = 0x46494D42;

  function garcLire(donnees) {
    verifierOctets(donnees);
    if (donnees.length < 0x1C || u32(donnees, 0) !== MAGIC_GARC) throw new Error('pas un GARC (magic absent)');
    var longueurEntete = u32(donnees, 4), bom = u16(donnees, 8), version = u16(donnees, 10);
    var sections = u32(donnees, 12), debutDonnees = u32(donnees, 16);
    if (bom !== 0xFEFF) throw new Error('marque d\'ordre des octets inattendue : 0x' + hex(bom));
    if (version !== 0x0400 && version !== 0x0600) throw new Error('version GARC inconnue : 0x' + hex(version));
    if (sections !== 4) throw new Error(sections + ' sections au lieu de 4');
    function besoin(p, k, quoi) { if (p + k > donnees.length) throw new Error('GARC tronqué : ' + quoi + ' attendu à 0x' + hex(p)); }
    var pos = longueurEntete;
    besoin(pos, 12, 'FATO');
    if (u32(donnees, pos) !== MAGIC_FATO) throw new Error('FATO attendu à 0x' + hex(pos));
    var tailleFato = u32(donnees, pos + 4), nbEntrees = u16(donnees, pos + 8);
    besoin(pos + 0xC, 4 * nbEntrees, 'la table FATO');
    var decalages = [];
    for (var k = 0; k < nbEntrees; k++) decalages.push(u32(donnees, pos + 0xC + 4 * k));
    pos += tailleFato;
    besoin(pos, 12, 'FATB');
    if (u32(donnees, pos) !== MAGIC_FATB) throw new Error('FATB attendu à 0x' + hex(pos));
    var tailleFatb = u32(donnees, pos + 4);
    var baseFatb = pos + 0xC, posFimb = pos + tailleFatb;
    besoin(posFimb, 12, 'FIMB');
    if (u32(donnees, posFimb) !== MAGIC_FIMB) throw new Error('FIMB attendu à 0x' + hex(posFimb));
    var entrees = [];
    for (var e = 0; e < decalages.length; e++) {
      var p = baseFatb + decalages[e];
      besoin(p, 4, 'le vecteur du numéro ' + e);
      var vecteur = u32(donnees, p);
      p += 4;
      var sous = [];
      for (var bit = 0; bit < 32; bit++) {
        if (vecteur >>> bit & 1) {
          besoin(p, 12, 'l\'entrée ' + e + '.' + sous.length);
          var debut = u32(donnees, p), longueur = u32(donnees, p + 8);
          p += 12;
          var a = debutDonnees + debut;
          if (a + longueur > donnees.length) throw new Error('le sous-fichier ' + e + '.' + sous.length + ' dépasse la fin du GARC');
          sous.push(donnees.subarray(a, a + longueur));
        }
      }
      entrees.push(sous);
    }
    return { version: version >> 8, entrees: entrees };
  }

  function garcEcrire(entrees, version, alignement) {
    if (version === 4 || version === undefined) version = 0x0400;
    else if (version === 6) version = 0x0600;
    if (version !== 0x0400 && version !== 0x0600) throw new Error('version GARC inconnue : ' + version);
    alignement = alignement || 4;
    var fatb = new Ecrivain(), fimb = new Ecrivain(), decalages = [];
    var plusGros = 0, plusGrosPadde = 0, total = 0;
    entrees.forEach(function (sous) {
      if (sous.length > 32) throw new Error('un numéro GARC porte au plus 32 sous-fichiers');
      decalages.push(fatb.n);
      var vecteur = 0;
      for (var i = 0; i < sous.length; i++) vecteur = (vecteur | 1 << i) >>> 0;
      fatb.u32(vecteur);
      sous.forEach(function (f) {
        var debut = fimb.n;
        fimb.octets(f);
        var reste = (alignement - fimb.n % alignement) % alignement;
        for (var r = 0; r < reste; r++) fimb.u8(0xFF);
        fatb.u32(debut); fatb.u32(fimb.n); fatb.u32(f.length);
        plusGros = Math.max(plusGros, f.length);
        plusGrosPadde = Math.max(plusGrosPadde, f.length + reste);
        total++;
      });
    });
    var w = new Ecrivain();
    var longueurEntete = version === 0x0600 ? 0x24 : 0x1C;
    var tailleFato = 0xC + 4 * decalages.length, tailleFatb = 0xC + fatb.n;
    var debutDonnees = longueurEntete + tailleFato + tailleFatb + 0xC;
    w.u32(MAGIC_GARC); w.u32(longueurEntete); w.u16(0xFEFF); w.u16(version); w.u32(4);
    w.u32(debutDonnees); w.u32(debutDonnees + fimb.n);
    if (version === 0x0600) { w.u32(plusGrosPadde); w.u32(plusGros); w.u32(alignement); } else w.u32(plusGros);
    w.u32(MAGIC_FATO); w.u32(tailleFato); w.u16(decalages.length); w.u16(0xFFFF);
    decalages.forEach(function (d) { w.u32(d); });
    w.u32(MAGIC_FATB); w.u32(tailleFatb); w.u32(total); w.octets(fatb.fin());
    w.u32(MAGIC_FIMB); w.u32(0xC); w.u32(fimb.n);
    w.octets(fimb.fin());
    return w.fin();
  }

  // ---------------------------------------------------------------- LZ10 / LZ11 (lz11.py)

  // Un flux plausible : octet 0x10 ou 0x11, taille annoncée non nulle, compatible avec la taille du
  // fichier (même tout en littéraux, un flux ne fait pas plus de 4 + 9/8 de la taille décompressée,
  // plus un peu de remplissage), et premier élément forcément un littéral.
  function lzEstCompresse(octets, tailleTotale) {
    if (!octets || octets.length < 5) return false;
    var type = octets[0];
    if (type !== 0x10 && type !== 0x11) return false;
    var taille = octets[1] | octets[2] << 8 | octets[3] << 16;
    var n = tailleTotale === undefined ? octets.length : tailleTotale;
    if (taille === 0 || n < 6) return false;
    if (octets[4] & 0x80) return false;
    if (n > 4 + Math.ceil(taille * 9 / 8) + 0x20) return false;
    if (taille > (n - 4) * 0x2000 + 64) return false;
    return true;
  }

  function lzDecompresser(donnees) {
    verifierOctets(donnees);
    if (donnees.length < 4 || (donnees[0] !== 0x10 && donnees[0] !== 0x11)) {
      throw new Error('pas un flux LZ10/LZ11 (octet de type ' + (donnees.length ? '0x' + hex(donnees[0], 2) : 'absent') + ')');
    }
    var type = donnees[0];
    var taille = donnees[1] | donnees[2] << 8 | donnees[3] << 16;
    var sortie = new Uint8Array(taille), n = 0, pos = 4, len = donnees.length;
    function tronque() { return new Error('flux tronqué à ' + n + ' octets sur ' + taille); }
    while (n < taille) {
      if (pos >= len) throw tronque();
      var drapeaux = donnees[pos++];
      for (var bit = 7; bit >= 0; bit--) {
        if (n >= taille) break;
        if (!(drapeaux >> bit & 1)) {
          if (pos >= len) throw tronque();
          sortie[n++] = donnees[pos++];
          continue;
        }
        if (pos + 1 >= len) throw tronque();
        var b1 = donnees[pos], longueur, distance;
        if (type === 0x10) {
          longueur = (b1 >> 4) + 3;
          distance = ((b1 & 0xF) << 8 | donnees[pos + 1]) + 1;
          pos += 2;
        } else {
          var haut = b1 >> 4;
          if (haut === 0) {
            if (pos + 2 >= len) throw tronque();
            var b2 = donnees[pos + 1];
            longueur = ((b1 & 0xF) << 4 | b2 >> 4) + 0x11;
            distance = ((b2 & 0xF) << 8 | donnees[pos + 2]) + 1;
            pos += 3;
          } else if (haut === 1) {
            if (pos + 3 >= len) throw tronque();
            var c2 = donnees[pos + 1], c3 = donnees[pos + 2];
            longueur = ((b1 & 0xF) << 12 | c2 << 4 | c3 >> 4) + 0x111;
            distance = ((c3 & 0xF) << 8 | donnees[pos + 3]) + 1;
            pos += 4;
          } else {
            longueur = haut + 1;
            distance = ((b1 & 0xF) << 8 | donnees[pos + 1]) + 1;
            pos += 2;
          }
        }
        if (distance > n) throw new Error('référence arrière hors du flux (distance ' + distance + ' à la position ' + n + ')');
        // Comme en Python, on copie octet par octet (la source peut chevaucher la destination),
        // et ce qui dépasse la taille annoncée est jeté.
        for (var k = 0; k < longueur && n < taille; k++, n++) sortie[n] = sortie[n - distance];
      }
    }
    return sortie;
  }

  // Compression LZ11 gloutonne, lente mais exacte : la même que lz11.py, pour les tests.
  function lzCompresser(donnees) {
    if (donnees.length >= 1 << 24) throw new Error('trop gros pour LZ11 (taille sur trois octets)');
    var w = new Ecrivain();
    w.u8(0x11); w.u8(donnees.length & 0xFF); w.u8(donnees.length >> 8 & 0xFF); w.u8(donnees.length >> 16 & 0xFF);
    var pos = 0, FENETRE = 0x1000, MAXI = 0x10110, N = donnees.length;
    while (pos < N) {
      var drapeaux = 0, bloc = [];
      for (var bit = 7; bit >= 0; bit--) {
        if (pos >= N) break;
        var meilleurLong = 0, meilleurDist = 0, debut = Math.max(0, pos - FENETRE);
        for (var cand = pos - 1; cand >= debut; cand--) {
          var l = 0;
          while (pos + l < N && l < MAXI && donnees[cand + l] === donnees[pos + l]) l++;
          if (l > meilleurLong) { meilleurLong = l; meilleurDist = pos - cand; if (l >= MAXI) break; }
        }
        if (meilleurLong >= 3) {
          drapeaux |= 1 << bit;
          var d = meilleurDist - 1;
          if (meilleurLong <= 0x10) bloc.push((meilleurLong - 1) << 4 | d >> 8, d & 0xFF);
          else if (meilleurLong <= 0x110) { var a = meilleurLong - 0x11; bloc.push(a >> 4, (a & 0xF) << 4 | d >> 8, d & 0xFF); }
          else { var b = meilleurLong - 0x111; bloc.push(0x10 | b >> 12, b >> 4 & 0xFF, (b & 0xF) << 4 | d >> 8, d & 0xFF); }
          pos += meilleurLong;
        } else {
          bloc.push(donnees[pos]);
          pos++;
        }
      }
      w.u8(drapeaux);
      w.octets(bloc);
    }
    return w.fin();
  }

  // ---------------------------------------------------------------- Textes de X/Y (texte.py)

  var CLE_BASE = 0x7C89, CLE_AVANCE = 0x2983, VARIABLE = 0x0010, FIN = 0x0000;
  var DEFILER = 0xBE00, EFFACER = 0xBE01, PAUSE = 0xBE02, LIGNE_VIDE = 0xBDFF, DEBUT_SECTION = 0x10;

  // TextVariableCode.cs, VariableCodes_XY.
  var VARIABLES_XY = {
    0xFF00: 'COLOR', 0x0100: 'TRNAME', 0x0101: 'PKNAME', 0x0102: 'PKNICK', 0x0103: 'TYPE',
    0x0105: 'LOCATION', 0x0106: 'ABILITY', 0x0107: 'MOVE', 0x0108: 'ITEM1', 0x0109: 'ITEM2',
    0x010A: 'sTRBAG', 0x010B: 'BOX', 0x010D: 'EVSTAT', 0x0110: 'OPOWER', 0x0127: 'RIBBON',
    0x0134: 'MIINAME', 0x013E: 'WEATHER', 0x0189: 'TRNICK', 0x018A: '1stchrTR', 0x018B: 'SHOUTOUT',
    0x018E: 'BERRY', 0x018F: 'REMFEEL', 0x0190: 'REMQUAL', 0x0191: 'WEBSITE', 0x019C: 'CHOICECOS',
    0x01A1: 'GSYNCID', 0x0192: 'PRVIDSAY', 0x0193: 'BTLTEST', 0x0195: 'GENLOC', 0x0199: 'CHOICEFOOD',
    0x019A: 'HOTELITEM', 0x019B: 'TAXISTOP', 0x019F: 'MAISTITLE', 0x1000: 'ITEMPLUR0',
    0x1001: 'ITEMPLUR1', 0x1100: 'GENDBR', 0x1101: 'NUMBRNCH', 0x1302: 'iCOLOR2', 0x1303: 'iCOLOR3',
    0x0200: 'NUM1', 0x0201: 'NUM2', 0x0202: 'NUM3', 0x0203: 'NUM4', 0x0204: 'NUM5', 0x0205: 'NUM6',
    0x0206: 'NUM7', 0x0207: 'NUM8', 0x0208: 'NUM9'
  };
  var CODES_XY = {};
  Object.keys(VARIABLES_XY).forEach(function (c) { CODES_XY[VARIABLES_XY[c]] = +c; });
  // Caractères privés du jeu et leur équivalent Unicode (TextFile.cs, TryRemapChar / TryUnmapChar).
  var SYMBOLES = { 0xE07F: 0x202F, 0xE08D: 0x2026, 0xE08E: 0x2642, 0xE08F: 0x2640 };
  var SYMBOLES_INVERSES = {};
  Object.keys(SYMBOLES).forEach(function (j) { SYMBOLES_INVERSES[SYMBOLES[j]] = +j; });

  function cleDeLigne(i) { return (CLE_BASE + CLE_AVANCE * i) & 0xFFFF; }

  // OU exclusif mot par mot avec une clé qui tourne de 3 bits à chaque pas ; sert aussi à déchiffrer.
  function chiffrer(mots, cle) {
    var sortie = new Array(mots.length);
    for (var k = 0; k < mots.length; k++) {
      sortie[k] = mots[k] ^ cle;
      cle = (cle << 3 | cle >> 13) & 0xFFFF;
    }
    return sortie;
  }

  function motsVersTexte(mots, symboles) {
    var morceaux = [], i = 0;
    while (i < mots.length) {
      var m = mots[i];
      if (m === FIN) break;
      i++;
      if (m === VARIABLE) {
        if (i + 2 > mots.length) throw new Error('commande coupée en fin de ligne');
        var nombre = mots[i], code = mots[i + 1];
        i += 2;
        if (code === DEFILER) morceaux.push('\\r');
        else if (code === EFFACER) morceaux.push('\\c');
        else if (code === PAUSE || code === LIGNE_VIDE) {
          if (i >= mots.length) throw new Error('argument manquant après la commande 0x' + hex(code, 4));
          morceaux.push('[' + (code === PAUSE ? 'WAIT' : '~') + ' ' + mots[i] + ']');
          i++;
        } else {
          var attendus = Math.max(nombre - 1, 0);
          var args = nombre > 1 ? mots.slice(i, i + nombre - 1) : [];
          if (args.length !== attendus) throw new Error('arguments manquants pour la variable 0x' + hex(code, 4));
          i += args.length;
          var nom = VARIABLES_XY.hasOwnProperty(code) ? VARIABLES_XY[code] : hex(code, 4);
          morceaux.push('[VAR ' + nom + (args.length ? '(' + args.map(function (a) { return hex(a, 4); }).join(',') + ')' : '') + ']');
        }
      } else if (m === 0x0A) morceaux.push('\\n');
      else if (m === 0x5C) morceaux.push('\\\\');
      else if (m === 0x5B) morceaux.push('\\[');
      else morceaux.push(String.fromCharCode(symboles && SYMBOLES.hasOwnProperty(m) ? SYMBOLES[m] : m));
    }
    return morceaux.join('');
  }

  // int(x) et int(x, 16) de Python, sans leurs fantaisies (soulignés) : blancs autour, signe, préfixe 0x.
  function entierPython(s, base) {
    var re = base === 16 ? /^\s*([+-]?)(?:0x)?([0-9a-f]+)\s*$/i : /^\s*([+-]?)([0-9]+)\s*$/;
    var m = re.exec(s);
    if (!m) return null;
    var v = parseInt(m[2], base);
    return m[1] === '-' ? -v : v;
  }

  function nombreDeVariable(nom) {
    if (CODES_XY.hasOwnProperty(nom)) return CODES_XY[nom];
    var code = entierPython(nom, 16);
    return code !== null && code >= 0 && code <= 0xFFFF ? code : null;
  }

  function commandeVersMots(contenu) {
    var esp = contenu.indexOf(' ');
    var genre = esp < 0 ? contenu : contenu.slice(0, esp), reste = esp < 0 ? '' : contenu.slice(esp + 1);
    if (!reste) throw new Error('commande mal formée : [' + contenu + ']');
    if (genre === '~' || genre === 'WAIT') {
      var v = entierPython(reste, 10);
      if (v === null) throw new Error('nombre attendu dans [' + contenu + ']');
      return [VARIABLE, 1, genre === '~' ? LIGNE_VIDE : PAUSE, v & 0xFFFF];
    }
    if (genre !== 'VAR') throw new Error('commande inconnue : [' + contenu + ']');
    var par = reste.indexOf('(');
    var nom = par < 0 ? reste : reste.slice(0, par), args = par < 0 ? '' : reste.slice(par + 1);
    var code = nombreDeVariable(nom);
    if (code === null) throw new Error('variable inconnue : ' + nom);
    if (par < 0) return [VARIABLE, 1, code];
    if (args.slice(-1) !== ')') throw new Error('parenthèse non fermée : [' + contenu + ']');
    var valeurs = args.slice(0, -1).split(',').map(function (a) {
      var x = entierPython(a, 16);
      if (x === null) throw new Error('argument illisible « ' + a + ' » dans [' + contenu + ']');
      return x & 0xFFFF;
    });
    return [VARIABLE, 1 + valeurs.length, code].concat(valeurs);
  }

  var ECHAPPEMENTS = { n: [0x0A], '\\': [0x5C], '[': [0x5B], r: [VARIABLE, 1, DEFILER], c: [VARIABLE, 1, EFFACER] };

  function texteVersMots(texte, symboles) {
    var mots = [], i = 0;
    while (i < texte.length) {
      var c = texte[i];
      i++;
      if (c === '[') {
        var fin = texte.indexOf(']', i);
        if (fin < 0) throw new Error('crochet non fermé : ' + JSON.stringify(texte));
        Array.prototype.push.apply(mots, commandeVersMots(texte.slice(i, fin)));
        i = fin + 1;
      } else if (c === '\\') {
        if (i >= texte.length) throw new Error('barre oblique en fin de ligne : ' + JSON.stringify(texte));
        var e = texte[i];
        i++;
        if (!ECHAPPEMENTS.hasOwnProperty(e)) throw new Error('échappement inconnu \\' + e + ' dans ' + JSON.stringify(texte));
        Array.prototype.push.apply(mots, ECHAPPEMENTS[e]);
      } else {
        // Une unité UTF-16 à la fois : le jeu stocke de l'UCS-2. (Python refuse les caractères hors
        // du plan de base ; ici ils passent en paire de substitution, ce qui fait un aller-retour exact.)
        var u = c.charCodeAt(0);
        mots.push(symboles && SYMBOLES_INVERSES.hasOwnProperty(u) ? SYMBOLES_INVERSES[u] : u);
      }
    }
    mots.push(FIN);
    return mots;
  }

  // En-tête plausible d'un fichier de texte, sur les 0x14 premiers octets et la taille du fichier.
  function texteEstPlausible(tete, tailleTotale) {
    if (tete.length < DEBUT_SECTION + 4) return false;
    var n = tailleTotale === undefined ? tete.length : tailleTotale;
    var sections = u16(tete, 0), lignes = u16(tete, 2), longueur = u32(tete, 4), cle = u32(tete, 8), debut = u32(tete, 12);
    return sections === 1 && cle === 0 && debut === DEBUT_SECTION && debut + longueur === n &&
      u32(tete, debut) === longueur && 4 + 8 * lignes <= longueur;
  }

  function texteDecoder(donnees, options) {
    verifierOctets(donnees);
    var symboles = !!(options && options.symboles);
    if (donnees.length < DEBUT_SECTION + 4) throw new Error('trop court pour un fichier de texte (' + donnees.length + ' octets)');
    var sections = u16(donnees, 0), nbLignes = u16(donnees, 2), longueur = u32(donnees, 4);
    var cleInitiale = u32(donnees, 8), debut = u32(donnees, 12);
    if (sections !== 1) throw new Error(sections + ' sections au lieu de 1');
    if (cleInitiale !== 0) throw new Error('clé initiale 0x' + hex(cleInitiale) + ' au lieu de 0');
    if (debut + longueur !== donnees.length) throw new Error('taille annoncée ' + debut + ' + ' + longueur + ', fichier de ' + donnees.length + ' octets');
    if (u32(donnees, debut) !== longueur) throw new Error('longueur de section différente de celle de l\'en-tête');
    var lignes = [];
    for (var i = 0; i < nbLignes; i++) {
      var t = debut + 4 + 8 * i;
      if (t + 6 > donnees.length) throw new Error('table des lignes tronquée à la ligne ' + i);
      var decalage = u32(donnees, t), nbMots = u16(donnees, t + 4);
      var a = debut + decalage;
      if (a + 2 * nbMots > donnees.length) throw new Error('la ligne ' + i + ' dépasse la fin du fichier');
      var mots = new Array(nbMots);
      for (var k = 0; k < nbMots; k++) mots[k] = u16(donnees, a + 2 * k);
      lignes.push(motsVersTexte(chiffrer(mots, cleDeLigne(i)), symboles));
    }
    return lignes;
  }

  function texteEncoder(lignes, options) {
    var symboles = !!(options && options.symboles);
    if (lignes.length > 0xFFFF) throw new Error('trop de lignes : ' + lignes.length);
    var table = new Ecrivain(), corps = new Ecrivain();
    var debutCorps = 4 + 8 * lignes.length;
    lignes.forEach(function (ligne, i) {
      var mots = chiffrer(texteVersMots(ligne.split('\n').join('\\n'), symboles), cleDeLigne(i));
      var nbMots = mots.length + (mots.length % 2 ? 1 : 0);   // complété à un multiple de 4 octets
      if (nbMots > 0xFFFF) throw new Error('ligne ' + i + ' trop longue');
      table.u32(debutCorps + corps.n); table.u16(nbMots); table.u16(0);
      mots.forEach(function (m) { corps.u16(m); });
      if (mots.length % 2) corps.u16(0);
    });
    var longueur = 4 + table.n + corps.n;
    var w = new Ecrivain();
    w.u16(1); w.u16(lignes.length); w.u32(longueur); w.u32(0); w.u32(DEBUT_SECTION);
    w.u32(longueur); w.octets(table.fin()); w.octets(corps.fin());
    return w.fin();
  }

  // ---------------------------------------------------------------- Textures PICA200

  // Bits par pixel et ordre des octets (SPICA, TextureConverter.cs ; Ohana3DS, TextureCodec.cs).
  var BPP = { RGBA8: 32, RGB8: 24, RGBA5551: 16, RGB565: 16, RGBA4: 16, LA8: 16, HILO8: 16, L8: 8, A8: 8, LA4: 8, L4: 4, A4: 4, ETC1: 4, ETC1A4: 8 };
  // Numérotation du GPU (registres de texture, BCH) et numérotation des BCLIM : elles diffèrent.
  var FORMATS_PICA = ['RGBA8', 'RGB8', 'RGBA5551', 'RGB565', 'RGBA4', 'LA8', 'HILO8', 'L8', 'A8', 'LA4', 'L4', 'A4', 'ETC1', 'ETC1A4'];
  var FORMATS_CLIM = ['L8', 'A8', 'LA4', 'LA8', 'HILO8', 'RGB565', 'RGB8', 'RGBA5551', 'RGBA4', 'RGBA8', 'ETC1', 'ETC1A4', 'L4', 'A4'];

  // Dans une tuile de 8 × 8, le k-ième pixel stocké est à (x, y) où x prend les bits pairs de k et
  // y les bits impairs : l'ordre de Morton (la table SwizzleLUT de SPICA en est la forme dépliée).
  var MORTON_X = new Uint8Array(64), MORTON_Y = new Uint8Array(64);
  for (var mk = 0; mk < 64; mk++) {
    MORTON_X[mk] = (mk & 1) | (mk >> 1 & 2) | (mk >> 2 & 4);
    MORTON_Y[mk] = (mk >> 1 & 1) | (mk >> 2 & 2) | (mk >> 3 & 4);
  }

  function tailleTexture(format, largeur, hauteur) {
    if (!BPP[format]) throw new Error('format de texture inconnu : ' + format);
    return largeur * hauteur * BPP[format] / 8;
  }

  // Les modificateurs d'ETC1 (table de la norme, ETC1LUT chez SPICA).
  var ETC1_TABLE = [[2, 8], [5, 17], [9, 29], [13, 42], [18, 60], [24, 80], [33, 106], [47, 183]];

  function etc1Bloc(sortie, largeur, hauteur, bx, by, lo, hi, alphaLo, alphaHi) {
    var flip = hi & 1, diff = hi >> 1 & 1, table1 = hi >> 5 & 7, table2 = hi >> 2 & 7;
    var c1, c2;
    function etendre5(v) { return v << 3 | v >> 2; }
    function signe3(v) { return v & 4 ? v - 8 : v; }
    if (diff) {
      var r = hi >>> 27 & 31, g = hi >>> 19 & 31, b = hi >>> 11 & 31;
      var r2 = (r + signe3(hi >>> 24 & 7)) & 31, g2 = (g + signe3(hi >>> 16 & 7)) & 31, b2 = (b + signe3(hi >>> 8 & 7)) & 31;
      c1 = [etendre5(r), etendre5(g), etendre5(b)];
      c2 = [etendre5(r2), etendre5(g2), etendre5(b2)];
    } else {
      c1 = [(hi >>> 28 & 15) * 17, (hi >>> 20 & 15) * 17, (hi >>> 12 & 15) * 17];
      c2 = [(hi >>> 24 & 15) * 17, (hi >>> 16 & 15) * 17, (hi >>> 8 & 15) * 17];
    }
    for (var x = 0; x < 4; x++) {
      for (var y = 0; y < 4; y++) {
        var px = bx + x, py = by + y;
        if (px >= largeur || py >= hauteur) continue;
        var texel = x * 4 + y;                         // les pixels d'un bloc vont en colonnes
        var second = flip ? y >= 2 : x >= 2;
        var base = second ? c2 : c1, table = ETC1_TABLE[second ? table2 : table1];
        var mod = table[lo >>> texel & 1];
        if (lo >>> (texel + 16) & 1) mod = -mod;
        var a = 255;
        if (alphaLo !== undefined) {
          var nib = texel < 8 ? alphaLo >>> (texel * 4) & 15 : alphaHi >>> ((texel - 8) * 4) & 15;
          a = nib * 17;
        }
        var o = (py * largeur + px) * 4;
        for (var c = 0; c < 3; c++) { var v = base[c] + mod; sortie[o + c] = v < 0 ? 0 : v > 255 ? 255 : v; }
        sortie[o + 3] = a;
      }
    }
  }

  // Rend un Uint8ClampedArray RGBA de largeur × hauteur, la première ligne en haut.
  // Largeur et hauteur arrondies au multiple de 8 pour lire les tuiles, puis recadrées.
  function textureDecoder(octets, format, largeur, hauteur) {
    verifierOctets(octets);
    if (typeof format === 'number') format = FORMATS_PICA[format];
    if (!BPP[format]) throw new Error('format de texture inconnu : ' + format);
    if (!(largeur > 0 && hauteur > 0) || largeur > 4096 || hauteur > 4096) throw new Error('dimensions improbables : ' + largeur + ' × ' + hauteur);
    var L = Math.ceil(largeur / 8) * 8, H = Math.ceil(hauteur / 8) * 8;
    var besoin = tailleTexture(format, L, H);
    if (octets.length < besoin) throw new Error('il faut ' + besoin + ' octets pour ' + L + ' × ' + H + ' en ' + format + ', il y en a ' + octets.length);
    var sortie = new Uint8ClampedArray(largeur * hauteur * 4);
    var tuilesParLigne = L / 8, p = 0;
    if (format === 'ETC1' || format === 'ETC1A4') {
      var alpha = format === 'ETC1A4';
      for (var ty = 0; ty < H; ty += 8) {
        for (var tx = 0; tx < L; tx += 8) {
          for (var t = 0; t < 4; t++) {
            var aLo, aHi;
            if (alpha) { aLo = u32(octets, p); aHi = u32(octets, p + 4); p += 8; }
            var lo = u32(octets, p), hi = u32(octets, p + 4);
            p += 8;
            etc1Bloc(sortie, largeur, hauteur, tx + (t & 1) * 4, ty + (t >> 1) * 4, lo, hi, aLo, aHi);
          }
        }
      }
      return sortie;
    }
    var bpp = BPP[format], total = L * H;
    for (var k = 0; k < total; k++) {
      var tuile = k >> 6, dans = k & 63;
      var x = (tuile % tuilesParLigne) * 8 + MORTON_X[dans], y = Math.floor(tuile / tuilesParLigne) * 8 + MORTON_Y[dans];
      var r = 255, g = 255, b = 255, a = 255, q, v;
      switch (format) {
        case 'RGBA8': q = k * 4; a = octets[q]; b = octets[q + 1]; g = octets[q + 2]; r = octets[q + 3]; break;
        case 'RGB8': q = k * 3; b = octets[q]; g = octets[q + 1]; r = octets[q + 2]; break;
        case 'RGBA5551': v = u16(octets, k * 2); r = (v >> 11 & 31) * 255 / 31; g = (v >> 6 & 31) * 255 / 31; b = (v >> 1 & 31) * 255 / 31; a = (v & 1) * 255; break;
        case 'RGB565': v = u16(octets, k * 2); r = (v >> 11 & 31) * 255 / 31; g = (v >> 5 & 63) * 255 / 63; b = (v & 31) * 255 / 31; break;
        case 'RGBA4': v = u16(octets, k * 2); r = (v >> 12 & 15) * 17; g = (v >> 8 & 15) * 17; b = (v >> 4 & 15) * 17; a = (v & 15) * 17; break;
        case 'LA8': q = k * 2; a = octets[q]; r = g = b = octets[q + 1]; break;
        case 'HILO8': q = k * 2; r = octets[q + 1]; g = octets[q]; b = 0; break;
        case 'L8': r = g = b = octets[k]; break;
        case 'A8': a = octets[k]; break;
        case 'LA4': v = octets[k]; r = g = b = (v >> 4) * 17; a = (v & 15) * 17; break;
        case 'L4': v = octets[k >> 1] >> ((k & 1) * 4) & 15; r = g = b = v * 17; break;
        case 'A4': v = octets[k >> 1] >> ((k & 1) * 4) & 15; a = v * 17; break;
      }
      if (x >= largeur || y >= hauteur) continue;
      var o = (y * largeur + x) * 4;
      sortie[o] = r; sortie[o + 1] = g; sortie[o + 2] = b; sortie[o + 3] = a;
      p++;
    }
    return sortie;
  }

  // L'inverse, pour les formats sans compression : sert aux tests et à fabriquer de faux fichiers.
  function textureEncoder(rgba, format, largeur, hauteur) {
    if (typeof format === 'number') format = FORMATS_PICA[format];
    if (format === 'ETC1' || format === 'ETC1A4') throw new Error('pas d\'encodeur ETC1 ici');
    if (!BPP[format]) throw new Error('format de texture inconnu : ' + format);
    if (largeur % 8 || hauteur % 8) throw new Error('largeur et hauteur doivent être des multiples de 8');
    var sortie = new Uint8Array(tailleTexture(format, largeur, hauteur)), tuilesParLigne = largeur / 8;
    function q(v, bits) { return Math.round(v * ((1 << bits) - 1) / 255); }
    for (var k = 0; k < largeur * hauteur; k++) {
      var tuile = k >> 6, dans = k & 63;
      var x = (tuile % tuilesParLigne) * 8 + MORTON_X[dans], y = Math.floor(tuile / tuilesParLigne) * 8 + MORTON_Y[dans];
      var i = (y * largeur + x) * 4, r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
      var l = Math.round(0.299 * r + 0.587 * g + 0.114 * b), v;
      switch (format) {
        case 'RGBA8': sortie.set([a, b, g, r], k * 4); break;
        case 'RGB8': sortie.set([b, g, r], k * 3); break;
        case 'RGBA5551': v = q(r, 5) << 11 | q(g, 5) << 6 | q(b, 5) << 1 | (a >= 128 ? 1 : 0); sortie[k * 2] = v & 255; sortie[k * 2 + 1] = v >> 8; break;
        case 'RGB565': v = q(r, 5) << 11 | q(g, 6) << 5 | q(b, 5); sortie[k * 2] = v & 255; sortie[k * 2 + 1] = v >> 8; break;
        case 'RGBA4': v = q(r, 4) << 12 | q(g, 4) << 8 | q(b, 4) << 4 | q(a, 4); sortie[k * 2] = v & 255; sortie[k * 2 + 1] = v >> 8; break;
        case 'LA8': sortie[k * 2] = a; sortie[k * 2 + 1] = l; break;
        case 'HILO8': sortie[k * 2] = g; sortie[k * 2 + 1] = r; break;
        case 'L8': sortie[k] = l; break;
        case 'A8': sortie[k] = a; break;
        case 'LA4': sortie[k] = q(l, 4) << 4 | q(a, 4); break;
        case 'L4': sortie[k >> 1] |= q(l, 4) << ((k & 1) * 4); break;
        case 'A4': sortie[k >> 1] |= q(a, 4) << ((k & 1) * 4); break;
      }
    }
    return sortie;
  }

  // ---------------------------------------------------------------- BCLIM / BFLIM

  // Pied de page de 0x28 octets à la fin du fichier (Ohana3DS, BCLIM.cs) :
  //   « CLIM », BOM u16, longueur d'en-tête u16 (0x14), version u32, taille du fichier u32, blocs u32
  //   « imag », taille u32 (0x10), largeur u16, hauteur u16, format u32
  //   taille des données d'image u32
  // Les données d'image sont juste avant, aux dimensions arrondies à la puissance de deux.
  function piedClim(pied) {
    if (!pied || pied.length < 0x28) return null;
    var f = pied.length - 0x28;
    var magic = String.fromCharCode(pied[f], pied[f + 1], pied[f + 2], pied[f + 3]);
    if (magic !== 'CLIM' && magic !== 'FLIM') return null;
    if (String.fromCharCode(pied[f + 0x14], pied[f + 0x15], pied[f + 0x16], pied[f + 0x17]) !== 'imag') return null;
    var format = u32(pied, f + 0x20);
    if (magic === 'FLIM') format = format >> 16 & 0xF;
    return { magic: magic, largeur: u16(pied, f + 0x1C), hauteur: u16(pied, f + 0x1E), numero: format, format: FORMATS_CLIM[format] || null, taille: u32(pied, f + 0x24) };
  }

  function puissanceDeDeux(n) { var p = 8; while (p < n) p *= 2; return p; }

  function bclimLire(octets) {
    verifierOctets(octets);
    var p = piedClim(octets);
    if (!p) throw new Error('pas de pied de page CLIM à 0x28 octets de la fin');
    if (!p.format) throw new Error('format d\'image ' + p.numero + ' inconnu');
    var L = puissanceDeDeux(p.largeur), H = puissanceDeDeux(p.hauteur);
    var donnees = octets.subarray(0, octets.length - 0x28);
    // Si la taille ne colle pas aux puissances de deux, on essaie les multiples de 8.
    if (tailleTexture(p.format, L, H) > donnees.length) { L = Math.ceil(p.largeur / 8) * 8; H = Math.ceil(p.hauteur / 8) * 8; }
    var plein = textureDecoder(donnees, p.format, L, H);
    var rgba = new Uint8ClampedArray(p.largeur * p.hauteur * 4);
    for (var y = 0; y < p.hauteur; y++) rgba.set(plein.subarray(y * L * 4, (y * L + p.largeur) * 4), y * p.largeur * 4);
    return { magic: p.magic, largeur: p.largeur, hauteur: p.hauteur, format: p.format, numero: p.numero, stockee: L + ' × ' + H, rgba: rgba };
  }

  function bclimEcrire(rgba, largeur, hauteur, format) {
    var numero = FORMATS_CLIM.indexOf(format);
    if (numero < 0) throw new Error('format BCLIM inconnu : ' + format);
    var L = puissanceDeDeux(largeur), H = puissanceDeDeux(hauteur);
    var plein = new Uint8Array(L * H * 4);
    for (var y = 0; y < hauteur; y++) plein.set(rgba.subarray(y * largeur * 4, (y + 1) * largeur * 4), y * L * 4);
    var donnees = textureEncoder(plein, format, L, H);
    var w = new Ecrivain();
    w.octets(donnees);
    w.octets([0x43, 0x4C, 0x49, 0x4D]); w.u16(0xFEFF); w.u16(0x14); w.u32(0x02020000); w.u32(donnees.length + 0x28); w.u32(1);
    w.octets([0x69, 0x6D, 0x61, 0x67]); w.u32(0x10); w.u16(largeur); w.u16(hauteur); w.u32(numero);
    w.u32(donnees.length);
    return w.fin();
  }

  // ---------------------------------------------------------------- Paquet « mini » de Game Freak

  // Deux lettres, u16 nombre, puis nombre + 1 décalages u32 : le début du premier fichier, puis la fin
  // de chacun. On ne l'admet que si la table se tient.
  function miniEntete(tete, tailleTotale) {
    if (tete.length < 12) return null;
    var a = tete[0], b = tete[1];
    function lettre(c) { return (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A); }
    if (!lettre(a) || !lettre(b)) return null;
    var n = u16(tete, 2), total = tailleTotale === undefined ? tete.length : tailleTotale;
    if (n === 0 || n > 4096) return null;
    var debutMin = 4 + 4 * (n + 1);
    var premier = u32(tete, 4);
    if (premier < debutMin || premier > debutMin + 0x80 || premier > total) return null;
    var prec = premier, vus = Math.min(n, (tete.length - 8) >> 2);
    for (var k = 0; k < vus; k++) {
      var fin = u32(tete, 8 + 4 * k);
      if (fin < prec || fin > total) return null;
      prec = fin;
    }
    if (vus === n && total - prec > 0x80) return null;   // la dernière fin doit tomber près de la fin du fichier
    return { magic: String.fromCharCode(a, b), nombre: n };
  }

  function miniLire(octets) {
    verifierOctets(octets);
    var e = miniEntete(octets);
    if (!e) throw new Error('pas un paquet mini (table des décalages incohérente)');
    var fichiers = [], debut = u32(octets, 4);
    for (var k = 0; k < e.nombre; k++) {
      var fin = u32(octets, 8 + 4 * k);
      fichiers.push(octets.subarray(debut, fin));
      debut = fin;
    }
    return { magic: e.magic, fichiers: fichiers };
  }

  function miniEcrire(magic, fichiers) {
    var w = new Ecrivain();
    w.u8(magic.charCodeAt(0)); w.u8(magic.charCodeAt(1)); w.u16(fichiers.length);
    var p = 4 + 4 * (fichiers.length + 1);
    w.u32(p);
    fichiers.forEach(function (f) { p += f.length; w.u32(p); });
    fichiers.forEach(function (f) { w.octets(f); });
    return w.fin();
  }

  // ---------------------------------------------------------------- Reconnaissance

  var MAGICS_CONNUS = {
    'CGFX': 'modèle CGFX (le format de Nintendo, pas celui de Game Freak)',
    'CFNT': 'police de caractères CFNT', 'CWAV': 'son CWAV', 'CSTM': 'musique en flux CSTM',
    'CSAR': 'archive de sons CSAR', 'CWAR': 'archive d\'ondes CWAR', 'CBMD': 'bannière CBMD',
    'SARC': 'archive SARC', 'darc': 'archive darc', 'SMDH': 'icône et titres SMDH',
    'DVLB': 'shaders compilés DVLB', 'CTPK': 'paquet de textures CTPK', 'CLAN': 'animation de mise en page CLAN',
    'CLYT': 'mise en page CLYT', 'FLYT': 'mise en page FLYT', 'MsgS': 'messages MSBT', 'BCH\u0000': 'modèle BCH'
  };

  function lettres(o, p, n) { var s = ''; for (var k = 0; k < n && p + k < o.length; k++) s += String.fromCharCode(o[p + k]); return s; }
  function imprimable(s) { return /^[\x20-\x7E]+$/.test(s); }
  function octetsLisibles(n) { return n.toLocaleString('fr-FR') + ' octet' + (n > 1 ? 's' : ''); }

  // nature(octets, nom[, tailleTotale[, pied]]) : on peut ne passer que les premiers octets d'un gros
  // fichier ; tailleTotale donne alors sa vraie taille et pied ses 0x28 derniers octets (pour CLIM).
  function nature(octets, nom, tailleTotale, pied) {
    verifierOctets(octets);
    var n = tailleTotale === undefined ? octets.length : tailleTotale;
    if (pied === undefined && octets.length === n) pied = octets.subarray(Math.max(0, n - 0x28));
    if (n === 0) return { type: 'vide', libelle: 'Fichier vide.' };
    var m4 = lettres(octets, 0, 4);
    if (m4 === 'CRAG' && octets.length >= 0x1C) {
      var v = u16(octets, 10), le = u32(octets, 4), nb = octets.length >= le + 10 ? u16(octets, le + 8) : null;
      return { type: 'garc', version: v >> 8, nombre: nb, libelle: 'Conteneur GARC, version ' + (v >> 8) + (nb !== null ? ', ' + nb + ' numéro' + (nb > 1 ? 's' : '') : '') + '.' };
    }
    if (lzEstCompresse(octets, n)) {
      var t = octets[1] | octets[2] << 8 | octets[3] << 16;
      return { type: 'lz11', variante: octets[0] === 0x10 ? 'LZ10' : 'LZ11', tailleDecompressee: t,
        libelle: 'Compressé en ' + (octets[0] === 0x10 ? 'LZ10' : 'LZ11') + ', ' + octetsLisibles(t) + ' une fois décompressé.' };
    }
    if (texteEstPlausible(octets, n)) {
      var lignes = u16(octets, 2);
      return { type: 'texte', lignes: lignes, libelle: 'Texte de Pokémon X/Y, ' + lignes + ' ligne' + (lignes > 1 ? 's' : '') + ' chiffrée' + (lignes > 1 ? 's' : '') + '.' };
    }
    if (m4 === 'BCH\u0000') return { type: 'bch', libelle: 'Modèle BCH de Game Freak (maillages, textures, squelette ou animations).' };
    var clim = pied && n >= 0x28 ? piedClim(pied) : null;
    if (clim) {
      return { type: 'bclim', largeur: clim.largeur, hauteur: clim.hauteur, format: clim.format,
        libelle: 'Image ' + (clim.magic === 'FLIM' ? 'BFLIM' : 'BCLIM') + ' de ' + clim.largeur + ' × ' + clim.hauteur + ' pixels, en ' + (clim.format || 'format ' + clim.numero) + '.' };
    }
    var mini = miniEntete(octets, n);
    if (mini) return { type: 'mini', magic: mini.magic, nombre: mini.nombre, libelle: 'Paquet « ' + mini.magic + ' » de Game Freak, ' + mini.nombre + ' fichier' + (mini.nombre > 1 ? 's' : '') + ' (format mini, à vérifier).' };
    if (MAGICS_CONNUS[m4]) return { type: 'connu', magic: m4.replace('\u0000', ''), libelle: MAGICS_CONNUS[m4].charAt(0).toUpperCase() + MAGICS_CONNUS[m4].slice(1) + ', pas ouvert ici.' };
    if (lettres(octets, 0, 8) === 'MsgStdBn') return { type: 'connu', magic: 'MSBT', libelle: 'Messages MSBT, pas ouverts ici.' };
    if (octets[0] === 0x89 && m4.slice(1) === 'PNG') return { type: 'connu', magic: 'PNG', libelle: 'Image PNG.' };
    if (octets.length >= 4 && imprimable(m4)) return { type: 'inconnu', magic: m4, libelle: 'Magic « ' + m4 + ' », format pas encore connu ici.' };
    return { type: 'inconnu', libelle: octetsLisibles(n) + ', aucun magic reconnu.' };
  }

  // ---------------------------------------------------------------- Zip sans compression

  // Pour exporter un GARC éclaté d'un coup : méthode 0 (stockage), noms en UTF-8 (bit 11), sans
  // Zip64 (donc moins de 65 535 fichiers et de 4 Go). Format : APPNOTE de PKWARE, sections 4.3 et 4.4.
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ c >>> 1 : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(o) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < o.length; i++) c = CRC_TABLE[(c ^ o[i]) & 0xFF] ^ c >>> 8;
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    return new Uint8Array(Buffer.from(s, 'utf8'));
  }

  // fichiers : [{ nom, octets }] -> un tableau de morceaux (Uint8Array) à mettre dans un Blob.
  function zipEcrire(fichiers) {
    if (fichiers.length > 0xFFFE) throw new Error('trop de fichiers pour un zip sans Zip64');
    var morceaux = [], central = [], pos = 0;
    var DATE = (2014 - 1980) << 9 | 10 << 5 | 12, HEURE = 12 << 11;   // 12 octobre 2014, la sortie de X et Y
    fichiers.forEach(function (f) {
      var nom = utf8(f.nom), crc = crc32(f.octets), n = f.octets.length;
      var l = new Ecrivain();
      l.u32(0x04034B50); l.u16(20); l.u16(0x0800); l.u16(0); l.u16(HEURE); l.u16(DATE);
      l.u32(crc); l.u32(n); l.u32(n); l.u16(nom.length); l.u16(0); l.octets(nom);
      var tete = l.fin();
      var c = new Ecrivain();
      c.u32(0x02014B50); c.u16(20); c.u16(20); c.u16(0x0800); c.u16(0); c.u16(HEURE); c.u16(DATE);
      c.u32(crc); c.u32(n); c.u32(n); c.u16(nom.length); c.u16(0); c.u16(0); c.u16(0); c.u16(0); c.u32(0); c.u32(pos);
      c.octets(nom);
      central.push(c.fin());
      morceaux.push(tete, f.octets);
      pos += tete.length + n;
      if (pos > 0xFFFFFFFF) throw new Error('zip de plus de 4 Go');
    });
    var tailleCentral = 0;
    central.forEach(function (c) { morceaux.push(c); tailleCentral += c.length; });
    var e = new Ecrivain();
    e.u32(0x06054B50); e.u16(0); e.u16(0); e.u16(fichiers.length); e.u16(fichiers.length);
    e.u32(tailleCentral); e.u32(pos); e.u16(0);
    morceaux.push(e.fin());
    return morceaux;
  }

  var F = {
    garc: { lire: garcLire, ecrire: garcEcrire },
    zip: { ecrire: zipEcrire, crc32: crc32 },
    lz11: { estCompresse: lzEstCompresse, decompresser: lzDecompresser, compresser: lzCompresser },
    texte: { decoder: texteDecoder, encoder: texteEncoder, estPlausible: texteEstPlausible, VARIABLES_XY: VARIABLES_XY },
    texture: { decoder: textureDecoder, encoder: textureEncoder, taille: tailleTexture, FORMATS_PICA: FORMATS_PICA, FORMATS_CLIM: FORMATS_CLIM, BPP: BPP },
    bclim: { lire: bclimLire, ecrire: bclimEcrire, pied: piedClim },
    mini: { lire: miniLire, ecrire: miniEcrire, entete: miniEntete },
    nature: nature
  };
  racine.FORMATS3DS = F;
  if (typeof module !== 'undefined' && module.exports) module.exports = F;
})(typeof window !== 'undefined' ? window : globalThis);
