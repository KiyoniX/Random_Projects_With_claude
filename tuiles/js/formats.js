(function () {
  'use strict';

  var M = (typeof window !== 'undefined' ? window : globalThis).Tuiles, J = M.jeux;

  var FORMAT_PROJET = 'tuiles-projet', FORMAT_CARTE = 'tuiles-carte';
  var VERSION_TILED = '1.10';

  var F = M.formats = { FORMAT_PROJET: FORMAT_PROJET, FORMAT_CARTE: FORMAT_CARTE };

  // ---------- Outils ----------
  // Un tableau de cases est enregistré en plages : [longueur, valeur, longueur, valeur, …].
  function plages(t) {
    var o = [], i = 0, n = t.length, v, run;
    while (i < n) {
      v = t[i]; run = 1;
      while (i + run < n && t[i + run] === v) run++;
      o.push(run, v);
      i += run;
    }
    return o;
  }
  function deplier(p, n, Type) {
    var t = new Type(n), i = 0, k, run;
    if (!Array.isArray(p)) throw new Error('Calque illisible.');
    for (k = 0; k + 1 < p.length; k += 2) {
      run = p[k];
      if (!(run > 0) || i + run > n) throw new Error('Calque trop long.');
      if (p[k + 1]) t.fill(p[k + 1], i, i + run);
      i += run;
    }
    if (i !== n) throw new Error('Calque incomplet.');
    return t;
  }

  F.nomFichier = function (s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'carte';
  };
  // Nom du fichier image d'un jeu, unique dans la carte.
  F.fichierJeu = function (j) { return F.nomFichier(j.nom) + '-' + j.premier + '.png'; };

  function copieAnims(a) {
    var o = {}, k;
    for (k in a) o[k] = a[k].map(function (im) { return { t: im.t, d: im.d }; });
    return o;
  }

  // ---------- Projet ----------
  F.versProjet = function () {
    var c = M.carte;
    return {
      format: FORMAT_PROJET, version: 1,
      carte: { nom: c.nom, w: c.w, h: c.h, tc: c.tc, mode: c.mode, fond: c.fond, iCalque: c.iCalque, idSuivant: c.idSuivant, premierLibre: c.premierLibre },
      jeux: c.jeux.map(function (j) {
        return { id: j.id, premier: j.premier, nom: j.nom, tw: j.tw, th: j.th, cols: j.cols, nb: j.nb, pix: J.coder(j.pix), anims: copieAnims(j.anims), terrains: j.terrains.map(function (t) { return { nom: t.nom, forme: t.forme, base: t.base }; }), noms: j.noms, origine: j.origine };
      }),
      calques: c.calques.map(function (cal) {
        var o = { id: cal.id, nom: cal.nom, type: cal.type, visible: cal.visible, opacite: cal.opacite, verrou: cal.verrou };
        if (cal.cases) o.cases = plages(cal.cases);
        else o.objets = cal.objets.map(function (ob) { return { id: ob.id, nom: ob.nom, type: ob.type, x: ob.x, y: ob.y, w: ob.w, h: ob.h, props: ob.props.map(function (p) { return [p[0], p[1]]; }) }; });
        return o;
      })
    };
  };

  function entier(v, min, max, quoi) {
    v = Math.round(Number(v));
    if (!(v >= min && v <= max)) throw new Error('Projet invalide (' + quoi + ').');
    return v;
  }

  F.depuisProjet = function (o) {
    var s, c, ids = {}, max = 0, fin = 1, types = {};
    if (!o || o.format !== FORMAT_PROJET || !o.carte || !Array.isArray(o.jeux) || !Array.isArray(o.calques)) throw new Error('Ce fichier n\'est pas un projet de l\'éditeur de cartes.');
    s = o.carte;
    c = {
      nom: M.nomPropre(s.nom, 'carte'), w: entier(s.w, 1, M.CARTE_MAX, 'largeur'), h: entier(s.h, 1, M.CARTE_MAX, 'hauteur'),
      tc: entier(s.tc, 1, 64, 'taille de tuile'), mode: s.mode === 'plateformes' ? 'plateformes' : 'dessus', fond: typeof s.fond === 'string' ? s.fond : '',
      calques: [], jeux: [], iCalque: 0, idSuivant: 1, premierLibre: 1
    };
    if (M.TAILLES_TUILE.indexOf(c.tc) < 0) throw new Error('Projet invalide (taille de tuile).');
    function id(v) {
      v = entier(v, 1, 1e9, 'identifiant');
      if (ids[v]) throw new Error('Projet invalide (identifiant en double).');
      ids[v] = true; max = Math.max(max, v);
      return v;
    }
    o.jeux.forEach(function (src) {
      var tw = entier(src.tw, 1, J.TUILE_MAX, 'tuile'), th = entier(src.th, 1, J.TUILE_MAX, 'tuile'), cols = entier(src.cols, 1, 4096, 'colonnes'), nb = entier(src.nb, 1, 4096, 'tuiles');
      var rangs = Math.ceil(nb / cols), anims = {}, k, j;
      for (k in (src.anims || {})) {
        if (!(Number(k) >= 0 && Number(k) < nb) || !Array.isArray(src.anims[k])) continue;
        anims[k] = src.anims[k].map(function (im) { return { t: entier(im.t, 0, nb - 1, 'animation'), d: entier(im.d, 1, 600000, 'durée') }; });
        if (!anims[k].length) delete anims[k];
      }
      j = J.creer({
        nom: src.nom, tw: tw, th: th, cols: cols, nb: nb, pix: J.decoder(src.pix, cols * tw * rangs * th), anims: anims,
        terrains: (src.terrains || []).filter(function (t) { return (t.forme === 16 || t.forme === 47) && t.base >= 0 && t.base + t.forme <= nb; }).map(function (t) { return { nom: M.nomPropre(t.nom, 'Terrain'), forme: t.forme, base: Math.round(t.base) }; }),
        noms: src.noms && typeof src.noms === 'object' ? src.noms : {}, origine: String(src.origine || 'image')
      });
      j.id = id(src.id);
      j.premier = entier(src.premier, fin, 0x1fffffff, 'numérotation');
      fin = j.premier + j.nb;
      c.jeux.push(j);
    });
    o.calques.forEach(function (src) {
      var cal = { id: id(src.id), nom: M.nomPropre(src.nom, 'Calque'), type: src.type, visible: src.visible !== false, opacite: src.opacite === undefined ? 1 : M.borne(Number(src.opacite) || 0, 0, 1), verrou: !!src.verrou };
      if (src.type === 'tuiles') cal.cases = deplier(src.cases, c.w * c.h, Uint32Array);
      else if (src.type === 'collisions') {
        cal.cases = deplier(src.cases, c.w * c.h, Uint8Array);
        for (var i = 0; i < cal.cases.length; i++) if (cal.cases[i] > 4) cal.cases[i] = 1;
      } else if (src.type === 'objets') {
        cal.objets = (Array.isArray(src.objets) ? src.objets : []).map(function (ob) {
          return { id: id(ob.id), nom: String(ob.nom || '').slice(0, 40), type: String(ob.type || '').slice(0, 40), x: Math.round(ob.x) || 0, y: Math.round(ob.y) || 0, w: Math.max(0, Math.round(ob.w) || 0), h: Math.max(0, Math.round(ob.h) || 0), props: (Array.isArray(ob.props) ? ob.props : []).map(function (p) { return [String(p[0]), String(p[1])]; }) };
        });
      } else throw new Error('Projet invalide (type de calque).');
      if (src.type !== 'tuiles') {
        if (types[src.type]) throw new Error('Projet invalide (calque en double).');
        types[src.type] = true;
      }
      c.calques.push(cal);
    });
    if (!types.objets || !types.collisions || !c.calques.some(function (k) { return k.type === 'tuiles'; })) throw new Error('Projet invalide (calques manquants).');
    c.idSuivant = Math.max(max + 1, Math.round(s.idSuivant) || 0);
    c.premierLibre = Math.max(fin, Math.round(s.premierLibre) || 0);
    c.iCalque = M.borne(Math.round(s.iCalque) || 0, 0, c.calques.length - 1);
    M.installer(c);
  };

  // ---------- Export pour un moteur de jeu ----------
  // Format « tuiles-carte », décrit dans l'aide de l'outil. images(jeu) : rend l'image du jeu en
  // adresse data: pour l'incorporer, ou rien.
  F.versMoteur = function (images) {
    var c = M.carte, col = M.calqueDeType('collisions'), obj = M.calqueDeType('objets');
    return {
      format: FORMAT_CARTE, version: 1, nom: c.nom, largeur: c.w, hauteur: c.h, tuile: c.tc, mode: c.mode,
      jeux: c.jeux.map(function (j) {
        var anims = {}, k, o;
        for (k in j.anims) anims[j.premier + Number(k)] = j.anims[k].map(function (im) { return { tuile: j.premier + im.t, duree: im.d }; });
        o = { nom: j.nom, image: F.fichierJeu(j), premier: j.premier, nombre: j.nb, colonnes: j.cols, largeurTuile: j.tw, hauteurTuile: j.th, animations: anims };
        if (images) o.donnees = images(j);
        return o;
      }),
      calques: c.calques.filter(function (cal) { return cal.type === 'tuiles'; }).map(function (cal) {
        var n = cal.cases.length, cases = new Array(n), ori = new Array(n), i, v, tourne = false;
        for (i = 0; i < n; i++) {
          v = cal.cases[i];
          cases[i] = v & M.NUMERO;
          ori[i] = (v & M.RET_H ? 1 : 0) | (v & M.RET_V ? 2 : 0) | (v & M.RET_D ? 4 : 0);
          if (ori[i]) tourne = true;
        }
        v = { nom: cal.nom, visible: cal.visible, opacite: cal.opacite, cases: cases };
        if (tourne) v.orientations = ori;
        return v;
      }),
      collisions: { types: M.COLLISIONS.map(function (t) { return t.id; }), cases: Array.prototype.slice.call(col.cases) },
      objets: obj.objets.map(function (ob) {
        var p = {};
        ob.props.forEach(function (q) { p[q[0]] = q[1]; });
        return { id: ob.id, nom: ob.nom, type: ob.type, forme: ob.w || ob.h ? 'rectangle' : 'point', x: ob.x, y: ob.y, largeur: ob.w, hauteur: ob.h, proprietes: p };
      })
    };
  };

  // Relit un export « tuiles-carte » (sert de modèle de lecteur, et aux vérifications).
  F.lireMoteur = function (o) {
    if (!o || o.format !== FORMAT_CARTE) throw new Error('Ce fichier n\'est pas une carte exportée.');
    var n = o.largeur * o.hauteur;
    return {
      nom: o.nom, w: o.largeur, h: o.hauteur, tc: o.tuile, mode: o.mode, jeux: o.jeux,
      calques: o.calques.map(function (cal) {
        var t = new Uint32Array(n), i, r;
        for (i = 0; i < n; i++) {
          r = cal.orientations ? cal.orientations[i] : 0;
          t[i] = (cal.cases[i] | (r & 1 ? M.RET_H : 0) | (r & 2 ? M.RET_V : 0) | (r & 4 ? M.RET_D : 0)) >>> 0;
        }
        return { nom: cal.nom, visible: cal.visible, opacite: cal.opacite, cases: t };
      }),
      collisions: Uint8Array.from(o.collisions.cases), objets: o.objets
    };
  };

  // ---------- Export pour Tiled ----------
  // Image du jeu « collisions » joint à l'export : une tuile par type, de gauche à droite.
  F.pixCollisions = function (tc) {
    var w = tc * 4, p = new Uint32Array(w * tc), x, y, rouge = J.rgba(226, 102, 90, 200), ep = Math.max(2, Math.round(tc / 5));
    for (y = 0; y < tc; y++) {
      for (x = 0; x < tc; x++) {
        p[y * w + x] = rouge;
        if (y < ep) p[y * w + tc + x] = rouge;
        if (x + y >= tc - 1) p[y * w + 2 * tc + x] = rouge;
        if (y >= x) p[y * w + 3 * tc + x] = rouge;
      }
    }
    return { pix: p, w: w, h: tc };
  };

  // Rend { carte (l'objet du fichier .tmj), images [{ fichier, jeu | collisions }] }.
  F.versTiled = function () {
    var c = M.carte, images = [], premierCol = c.premierLibre, layers = [], tilesets;
    tilesets = c.jeux.map(function (j) {
      var tiles = [], k, f = F.fichierJeu(j);
      for (k in j.anims) tiles.push({ id: Number(k), animation: j.anims[k].map(function (im) { return { tileid: im.t, duration: im.d }; }) });
      images.push({ fichier: f, jeu: j });
      k = { firstgid: j.premier, name: j.nom, image: f, imagewidth: j.w, imageheight: j.h, tilewidth: j.tw, tileheight: j.th, tilecount: j.nb, columns: j.cols, margin: 0, spacing: 0 };
      if (tiles.length) k.tiles = tiles;
      return k;
    });
    tilesets.push({ firstgid: premierCol, name: 'collisions', image: 'collisions.png', imagewidth: c.tc * 4, imageheight: c.tc, tilewidth: c.tc, tileheight: c.tc, tilecount: 4, columns: 4, margin: 0, spacing: 0 });
    images.push({ fichier: 'collisions.png', collisions: true });
    c.calques.forEach(function (cal) {
      var base = { id: cal.id, name: cal.nom, x: 0, y: 0, opacity: cal.opacite, visible: cal.visible, locked: cal.verrou }, i;
      if (cal.type === 'objets') {
        base.type = 'objectgroup'; base.draworder = 'topdown';
        base.objects = cal.objets.map(function (ob) {
          var o = { id: ob.id, name: ob.nom, type: ob.type, x: ob.x, y: ob.y, width: ob.w, height: ob.h, rotation: 0, visible: true };
          if (!ob.w && !ob.h) o.point = true;
          if (ob.props.length) o.properties = ob.props.map(function (p) { return { name: p[0], type: 'string', value: p[1] }; });
          return o;
        });
      } else {
        base.type = 'tilelayer'; base.width = c.w; base.height = c.h;
        base.data = new Array(cal.cases.length);
        if (cal.type === 'tuiles') for (i = 0; i < cal.cases.length; i++) base.data[i] = cal.cases[i];
        else {
          for (i = 0; i < cal.cases.length; i++) base.data[i] = cal.cases[i] ? premierCol + cal.cases[i] - 1 : 0;
          base.properties = [{ name: 'collisions', type: 'bool', value: true }];
        }
      }
      layers.push(base);
    });
    return {
      carte: {
        type: 'map', version: VERSION_TILED, tiledversion: '1.10.2', orientation: 'orthogonal', renderorder: 'right-down', infinite: false, compressionlevel: -1,
        width: c.w, height: c.h, tilewidth: c.tc, tileheight: c.tc, nextlayerid: c.idSuivant, nextobjectid: c.idSuivant,
        properties: [{ name: 'mode', type: 'string', value: c.mode }],
        layers: layers, tilesets: tilesets
      },
      images: images
    };
  };
})();
