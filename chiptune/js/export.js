(function () {
  'use strict';

  var P = window.Puce, C = window.Chiptune;
  var FE_EXPORT = 44100;
  var CRETE_CIBLE = 0.89;                 // -1 dB : niveau visé par la normalisation
  var CLE_AUTO = 'puce-a-l-oreille.projet';

  // ---------- WAV ----------
  // Mono, 16 bits, PCM.
  P.wav = function (ech, fe) {
    var n = ech.length, o = new Uint8Array(44 + n * 2), d = new DataView(o.buffer), i, x;
    function texte(pos, s) { for (var k = 0; k < s.length; k++) o[pos + k] = s.charCodeAt(k); }
    texte(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); texte(8, 'WAVE');
    texte(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
    d.setUint32(24, fe, true); d.setUint32(28, fe * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
    texte(36, 'data'); d.setUint32(40, n * 2, true);
    for (i = 0; i < n; i++) {
      x = ech[i];
      x = x > 1 ? 1 : x < -1 ? -1 : x;
      d.setInt16(44 + i * 2, Math.round(x * 32767), true);
    }
    return o;
  };

  P.crete = function (ech) {
    var m = 0, i, a;
    for (i = 0; i < ech.length; i++) { a = ech[i] < 0 ? -ech[i] : ech[i]; if (a > m) m = a; }
    return m;
  };
  P.normaliserNiveau = function (ech) {
    var m = P.crete(ech), g, i;
    if (m < 1e-6) return ech;
    g = CRETE_CIBLE / m;
    for (i = 0; i < ech.length; i++) ech[i] *= g;
    return ech;
  };

  // ---------- ZIP sans compression ----------
  var tableCrc = (function () {
    var t = new Uint32Array(256), n, c, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(o) {
    var c = 0xFFFFFFFF, i;
    for (i = 0; i < o.length; i++) c = tableCrc[(c ^ o[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  // fichiers : [{ nom, octets }]
  P.zip = function (fichiers) {
    var taille = 22, i, f, pos = 0, o, d, centre = [], nom, crc, k, debutCentre;
    for (i = 0; i < fichiers.length; i++) taille += 30 + 46 + 2 * fichiers[i].nom.length + fichiers[i].octets.length;
    o = new Uint8Array(taille); d = new DataView(o.buffer);
    for (i = 0; i < fichiers.length; i++) {
      f = fichiers[i]; nom = f.nom; crc = crc32(f.octets);
      centre.push({ pos: pos, crc: crc, f: f });
      d.setUint32(pos, 0x04034b50, true); d.setUint16(pos + 4, 20, true); d.setUint16(pos + 6, 0x0800, true);
      d.setUint32(pos + 14, crc, true); d.setUint32(pos + 18, f.octets.length, true); d.setUint32(pos + 22, f.octets.length, true);
      d.setUint16(pos + 26, nom.length, true);
      for (k = 0; k < nom.length; k++) o[pos + 30 + k] = nom.charCodeAt(k);
      o.set(f.octets, pos + 30 + nom.length);
      pos += 30 + nom.length + f.octets.length;
    }
    debutCentre = pos;
    for (i = 0; i < centre.length; i++) {
      f = centre[i].f; nom = f.nom;
      d.setUint32(pos, 0x02014b50, true); d.setUint16(pos + 4, 20, true); d.setUint16(pos + 6, 20, true); d.setUint16(pos + 8, 0x0800, true);
      d.setUint32(pos + 16, centre[i].crc, true); d.setUint32(pos + 20, f.octets.length, true); d.setUint32(pos + 24, f.octets.length, true);
      d.setUint16(pos + 28, nom.length, true); d.setUint32(pos + 42, centre[i].pos, true);
      for (k = 0; k < nom.length; k++) o[pos + 46 + k] = nom.charCodeAt(k);
      pos += 46 + nom.length;
    }
    d.setUint32(pos, 0x06054b50, true); d.setUint16(pos + 8, centre.length, true); d.setUint16(pos + 10, centre.length, true);
    d.setUint32(pos + 12, pos - debutCentre, true); d.setUint32(pos + 16, debutCentre, true);
    return o;
  };

  // ---------- Rendus ----------
  // quoi : 'morceau', 'boucle', 'motif', 'motif-boucle'
  P.rendre = function (quoi, normaliser) {
    var opt = { fe: FE_EXPORT }, ech;
    if (quoi === 'boucle' || quoi === 'motif-boucle') opt.boucle = true;
    if (quoi === 'motif' || quoi === 'motif-boucle') opt.motif = P.cur.motif;
    ech = C.rendreMorceau(P.projet, opt);
    return normaliser ? P.normaliserNiveau(ech) : ech;
  };
  P.rendreBruit = function (i, normaliser) {
    var ech = C.rendreBruitage(P.projet.bruitages[i], FE_EXPORT);
    return normaliser ? P.normaliserNiveau(ech) : ech;
  };

  function telecharger(nom, contenu, type) {
    var url = URL.createObjectURL(new Blob([contenu], { type: type })), a = document.createElement('a');
    a.href = url; a.download = nom;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  P.telecharger = telecharger;
  function base() { return C.cle(P.projet.titre) || 'morceau'; }
  P.nomBase = base;

  // Renvoie une phrase de compte rendu.
  P.exporterWav = function (quoi, normaliser) {
    var ech = P.rendre(quoi, normaliser), suffixe = { morceau: '', boucle: '-boucle', motif: '-' + C.cle(P.motif().nom), 'motif-boucle': '-' + C.cle(P.motif().nom) + '-boucle' }[quoi];
    if (!ech.length) return 'Rien à exporter : le morceau est vide.';
    telecharger(base() + suffixe + '.wav', P.wav(ech, FE_EXPORT), 'audio/wav');
    return 'Exporté : ' + base() + suffixe + '.wav, ' + (ech.length / FE_EXPORT).toFixed(2) + ' s.';
  };
  P.exporterBruitWav = function (i, normaliser) {
    var b = P.projet.bruitages[i], ech;
    if (!b) return 'Aucun bruitage à exporter.';
    ech = P.rendreBruit(i, normaliser);
    telecharger(C.cle(b.nom) + '.wav', P.wav(ech, FE_EXPORT), 'audio/wav');
    return 'Exporté : ' + C.cle(b.nom) + '.wav, ' + (ech.length / FE_EXPORT).toFixed(2) + ' s.';
  };
  P.exporterBruitsZip = function (normaliser) {
    var vus = {}, fichiers = P.projet.bruitages.map(function (b, i) {
      var nom = C.cle(b.nom) || 'bruitage';
      if (vus[nom]) nom += '-' + (i + 1);
      vus[nom] = true;
      return { nom: nom + '.wav', octets: P.wav(P.rendreBruit(i, normaliser), FE_EXPORT) };
    });
    if (!fichiers.length) return 'Aucun bruitage à exporter.';
    telecharger(base() + '-bruitages.zip', P.zip(fichiers), 'application/zip');
    return 'Exporté : ' + fichiers.length + ' bruitages dans ' + base() + '-bruitages.zip.';
  };
  // Le fichier que charge un jeu : un appel à Chiptune.ajouter avec le morceau et ses bruitages.
  P.texteLecteur = function () {
    return '// ' + P.projet.titre + ' : à charger après lecteur.js, puis Chiptune.jouer(\'' + base() + '\').\n' +
      'Chiptune.ajouter(' + JSON.stringify(base()) + ', ' + P.serialiser() + ');\n';
  };
  P.exporterLecteur = function () {
    telecharger(base() + '.js', P.texteLecteur(), 'text/javascript');
    return 'Exporté : ' + base() + '.js. Dans le jeu : Chiptune.jouer(\'' + base() + '\').';
  };
  P.enregistrer = function () {
    telecharger(base() + '.json', P.serialiser(), 'application/json');
    return 'Projet enregistré : ' + base() + '.json.';
  };
  // Lit un fichier de projet (.json, ou le .js destiné au lecteur). Appelle fin(erreur).
  P.ouvrirFichier = function (fichier, fin) {
    var l = new FileReader();
    l.onload = function () {
      var t = String(l.result), m;
      try {
        m = /Chiptune\.ajouter\(\s*"[^"]*"\s*,\s*([\s\S]*)\);\s*$/.exec(t);
        P.ouvrir(JSON.parse(m ? m[1] : t));
        fin('');
      } catch (e) {
        fin(e instanceof SyntaxError ? 'Ce fichier n\'est pas un projet lisible (JSON invalide).' : e.message);
      }
    };
    l.onerror = function () { fin('Le fichier n\'a pas pu être lu.'); };
    l.readAsText(fichier);
  };

  // ---------- Sauvegarde automatique ----------
  P.sauverAuto = function () {
    try { localStorage.setItem(CLE_AUTO, P.serialiser()); return true; } catch (e) { return false; }
  };
  P.restaurerAuto = function () {
    try {
      var t = localStorage.getItem(CLE_AUTO);
      if (!t) return false;
      P.ouvrir(JSON.parse(t));
      return true;
    } catch (e) { return false; }
  };
})();
