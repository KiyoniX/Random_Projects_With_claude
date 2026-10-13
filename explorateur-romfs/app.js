// Explorateur de romfs : la page. Les formats sont dans formats.js (window.FORMATS3DS).
// Rien ne quitte le navigateur : les fichiers sont lus sur place par l'API File.
(function () {
  'use strict';

  var F = window.FORMATS3DS;
  var $ = function (s) { return document.querySelector(s); };

  // ================================================================ le modèle

  // Un nœud est un dossier (un tiroir), un fichier du disque, une pièce en mémoire (sous-fichier
  // d'un GARC ou d'un paquet mini) ou un groupe (un numéro de GARC qui a plusieurs sous-fichiers).
  var racine = null, courant = null, idSeq = 0, parId = new Map();
  var lignes = [], hauts = [], hautTotal = 0;
  var filtreNom = '', filtreTypes = new Set();
  var stats = { fichiers: 0, dossiers: 0, octets: 0, lus: 0 };

  function noeud(genre, nom, parent, extra) {
    var n = { id: ++idSeq, genre: genre, nom: nom, parent: parent, ouvert: false, enfants: null, nature: null, interne: null, erreur: null, taille: 0 };
    if (extra) for (var k in extra) n[k] = extra[k];
    parId.set(n.id, n);
    return n;
  }

  function typeDe(n) {
    if (n.genre === 'dossier') return 'dossier';
    if (n.genre === 'groupe') return 'groupe';
    if (n.erreur) return 'illisible';
    var t = (n.interne || n.nature || {}).type;
    return t || 'attente';
  }
  function estBoite(n) { var t = typeDe(n); return (n.genre === 'fichier' || n.genre === 'piece') && (t === 'garc' || t === 'mini'); }
  function estConteneur(n) { return n.genre === 'dossier' || n.genre === 'groupe' || estBoite(n); }

  function chemin(n) {
    var morceaux = [], fichierVu = false, p = n;
    while (p && p !== racine) {
      if (p.genre === 'piece' || p.genre === 'groupe') morceaux.unshift({ s: ' › ', nom: p.nom });
      else { morceaux.unshift({ s: '/', nom: p.nom }); fichierVu = true; }
      p = p.parent;
    }
    var t = '';
    morceaux.forEach(function (m, i) { t += (i ? m.s : '') + m.nom; });
    return t || (racine ? racine.nom : '');
  }
  function fichierPorteur(n) { var p = n; while (p && p.genre !== 'fichier') p = p.parent; return p; }

  function nombre(n) { return n.toLocaleString('fr-FR'); }
  function taille(n) {
    if (n < 1024) return nombre(n) + ' o';
    if (n < 1024 * 1024) return (n / 1024).toLocaleString('fr-FR', { maximumFractionDigits: n < 10240 ? 1 : 0 }) + ' Kio';
    return (n / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mio';
  }
  function octetsEnToutes(n) { return nombre(n) + ' octet' + (n > 1 ? 's' : ''); }
  function pad(n, k) { var s = String(n); while (s.length < k) s = '0' + s; return s; }
  function echapper(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pause() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function phrase(m) { return String(m).replace(/[.\s]+$/, ''); }

  // ================================================================ les tampons

  // Chaque nature a sa forme d'empreinte, pas seulement son nom : la forme double la couleur.
  var MOTS = { garc: 'GARC', lz11: 'LZ11', texte: 'TEXTE', bch: 'BCH', bclim: 'IMAGE', mini: 'PAQUET', connu: 'CONNU', inconnu: 'INCONNU', vide: 'VIDE', illisible: 'ILLISIBLE', attente: '' };
  var PETITS = { garc: 'GARC', lz11: 'LZ11', texte: 'texte', bch: 'BCH', bclim: 'image', mini: 'paquet', connu: 'connu', inconnu: 'inconnu', vide: 'vide', illisible: 'illisible', attente: '…' };

  function formeTampon(type, w, h, e) {
    // e : épaisseur du trait. Les formes sont dessinées dans une boîte w × h.
    var m = e / 2 + 1, x0 = m, y0 = m, x1 = w - m, y1 = h - m, s = '';
    switch (type) {
      case 'garc':        // double cadre : la boîte
        s = '<rect x="' + x0 + '" y="' + y0 + '" width="' + (x1 - x0) + '" height="' + (y1 - y0) + '"/>' +
          '<rect x="' + (x0 + e * 2) + '" y="' + (y0 + e * 2) + '" width="' + (x1 - x0 - e * 4) + '" height="' + (y1 - y0 - e * 4) + '"/>';
        break;
      case 'lz11': {      // cadre pincé de chaque côté : la presse
        var p = h * 0.22;
        s = '<path d="M' + x0 + ' ' + y0 + 'H' + x1 + 'L' + (x1 - p) + ' ' + h / 2 + 'L' + x1 + ' ' + y1 + 'H' + x0 + 'L' + (x0 + p) + ' ' + h / 2 + 'Z"/>';
        break;
      }
      case 'texte':       // ovale
        s = '<ellipse cx="' + w / 2 + '" cy="' + h / 2 + '" rx="' + (w / 2 - m) + '" ry="' + (h / 2 - m) + '"/>';
        break;
      case 'bch': {       // hexagone : le volume
        var q = h * 0.32;
        s = '<path d="M' + (x0 + q) + ' ' + y0 + 'H' + (x1 - q) + 'L' + x1 + ' ' + h / 2 + 'L' + (x1 - q) + ' ' + y1 + 'H' + (x0 + q) + 'L' + x0 + ' ' + h / 2 + 'Z"/>';
        break;
      }
      case 'bclim': {     // traits de coupe aux quatre coins : le cadrage
        var c = Math.min(w, h) * 0.32;
        s = '<path d="M' + x0 + ' ' + (y0 + c) + 'V' + y0 + 'H' + (x0 + c) + 'M' + (x1 - c) + ' ' + y0 + 'H' + x1 + 'V' + (y0 + c) +
          'M' + x1 + ' ' + (y1 - c) + 'V' + y1 + 'H' + (x1 - c) + 'M' + (x0 + c) + ' ' + y1 + 'H' + x0 + 'V' + (y1 - c) + '"/>';
        break;
      }
      case 'mini': {      // cadre à onglet : la chemise
        var o = h * 0.22;
        s = '<path d="M' + x0 + ' ' + (y0 + o) + 'H' + (x0 + w * 0.12) + 'L' + (x0 + w * 0.18) + ' ' + y0 + 'H' + (x0 + w * 0.42) + 'L' + (x0 + w * 0.48) + ' ' + (y0 + o) + 'H' + x1 + 'V' + y1 + 'H' + x0 + 'Z"/>';
        break;
      }
      case 'inconnu': case 'vide':   // cadre en tirets : on ne sait pas
        s = '<rect x="' + x0 + '" y="' + y0 + '" width="' + (x1 - x0) + '" height="' + (y1 - y0) + '" stroke-dasharray="' + (e * 2.5) + ' ' + (e * 1.8) + '"/>';
        break;
      case 'illisible':   // cadre barré d'une croix
        s = '<rect x="' + x0 + '" y="' + y0 + '" width="' + (x1 - x0) + '" height="' + (y1 - y0) + '"/>' +
          '<path d="M' + x0 + ' ' + y0 + 'L' + x1 + ' ' + y1 + 'M' + x1 + ' ' + y0 + 'L' + x0 + ' ' + y1 + '" stroke-opacity=".45"/>';
        break;
      case 'attente':
        s = '<circle cx="' + w / 2 + '" cy="' + h / 2 + '" r="' + e + '" fill="currentColor"/>';
        break;
      default:            // connu : cadre simple
        s = '<rect x="' + x0 + '" y="' + y0 + '" width="' + (x1 - x0) + '" height="' + (y1 - y0) + '"/>';
    }
    return s;
  }

  function miniTampon(type) {
    var couleur = type === 'illisible' ? 'var(--rouge)' : 'currentColor';
    return '<svg class="mini-tampon" viewBox="0 0 22 14" aria-hidden="true" fill="none" stroke="' + couleur + '" stroke-width="1.4" style="color:' + (type === 'illisible' ? 'var(--rouge)' : 'inherit') + '">' + formeTampon(type, 22, 14, 1.4) + '</svg>';
  }

  function grandTampon(type, mot) {
    var rouge = type === 'illisible';
    var couleur = rouge ? 'var(--rouge)' : 'var(--encre)';
    var texte = mot || MOTS[type] || type.toUpperCase();
    var fs = texte.length > 7 ? 15 : 18;
    return '<svg class="tampon-svg" viewBox="0 0 132 52" role="img" aria-label="Tampon : ' + echapper(texte.toLowerCase()) + '" fill="none" stroke="' + couleur + '" stroke-width="2.6" opacity=".88">' +
      formeTampon(type, 132, 52, 2.6) +
      '<text x="66" y="' + (26 + fs * 0.36) + '" text-anchor="middle" font-size="' + fs + '" fill="' + couleur + '" stroke="none">' + echapper(texte) + '</text></svg>';
  }

  // ================================================================ lecture des octets

  var cache = [];           // les derniers contenus lus ou décompressés, pour ne pas relire le disque
  var CACHE_MAX = 192 * 1048576;
  function mettreEnCache(n, octets) {
    cache = cache.filter(function (c) { return c.n !== n; });
    cache.push({ n: n, o: octets });
    var total = 0;
    for (var i = cache.length - 1; i >= 0; i--) {
      total += cache[i].o.length;
      if (total > CACHE_MAX && cache[i].n !== courant) { cache.splice(i, 1); }
    }
  }
  function enCache(n) { for (var i = 0; i < cache.length; i++) if (cache[i].n === n) return cache[i].o; return null; }

  function lireTranche(fichier, debut, fin) {
    return fichier.slice(debut, fin).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  function octetsBruts(n) {
    if (n.genre === 'piece') return Promise.resolve(n.brut);
    if (n.genre !== 'fichier') return Promise.reject(new Error('rien à lire dans un dossier'));
    var c = enCache(n);
    if (c && !n.lz) return Promise.resolve(c);
    return n.fichier.arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  // Le contenu utile : décompressé si c'est du LZ10/LZ11. Remplit n.interne au passage.
  function contenu(n) {
    var c = enCache(n);
    if (c) return Promise.resolve(c);
    return octetsBruts(n).then(function (brut) {
      if (!n.nature) n.nature = F.nature(brut, n.nom);
      var sortie = brut;
      if (n.nature.type === 'lz11') {
        try { sortie = F.lz11.decompresser(brut); }
        catch (e) { n.erreur = 'La décompression a échoué : ' + e.message + '.'; throw e; }
        n.interne = F.nature(sortie, n.nom);
        n.tailleContenu = sortie.length;
      }
      if (n.genre === 'fichier' || n.nature.type === 'lz11') mettreEnCache(n, sortie);
      return sortie;
    });
  }

  // ================================================================ chargement

  function viderTout() {
    racine = null; courant = null; parId.clear(); cache = []; idSeq = 0;
    stats = { fichiers: 0, dossiers: 0, octets: 0, lus: 0 };
    rechercheJeton++;
  }

  // liste : [{ chemin: 'romfs/a/0/7/2', fichier: File }]
  function charger(liste) {
    if (!liste.length) return;
    viderTout();
    liste.sort(function (a, b) { return a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0; });
    var premiers = new Set(liste.map(function (e) { return e.chemin.split('/')[0]; }));
    var commun = premiers.size === 1 && liste.every(function (e) { return e.chemin.indexOf('/') > 0; });
    racine = noeud('dossier', commun ? Array.from(premiers)[0] : 'fichiers posés', null, { enfants: [], ouvert: true });
    var fichiers = [];
    liste.forEach(function (e) {
      var parts = e.chemin.split('/').filter(Boolean);
      if (commun) parts.shift();
      var d = racine;
      for (var i = 0; i < parts.length - 1; i++) {
        var nom = parts[i], suivant = null;
        for (var k = 0; k < d.enfants.length; k++) if (d.enfants[k].genre === 'dossier' && d.enfants[k].nom === nom) { suivant = d.enfants[k]; break; }
        if (!suivant) { suivant = noeud('dossier', nom, d, { enfants: [] }); d.enfants.push(suivant); stats.dossiers++; }
        d = suivant;
      }
      var f = noeud('fichier', parts[parts.length - 1], d, { fichier: e.fichier, taille: e.fichier.size });
      d.enfants.push(f);
      fichiers.push(f);
      stats.fichiers++; stats.octets += e.fichier.size;
    });
    trier(racine);
    // Peu de fichiers : on ouvre tous les tiroirs. Sinon le premier niveau seulement.
    if (fichiers.length <= 40) ouvrirTout(racine);
    $('#q').disabled = false; $('#bChercher').disabled = false;
    $('#arbre').scrollTop = 0;
    majInventaire(); aplatir(); dessinerArbre();
    selectionner(racine);
    reconnaitre(fichiers).then(function () {
      if (fichiers.length === 1) {
        var seul = fichiers[0];
        selectionner(seul);
        if (estBoite(seul)) basculer(seul);
      }
    });
  }

  function trier(d) {
    // Dossiers d'abord, puis fichiers ; les noms numériques dans l'ordre des nombres.
    d.enfants.sort(function (a, b) {
      if ((a.genre === 'dossier') !== (b.genre === 'dossier')) return a.genre === 'dossier' ? -1 : 1;
      return a.nom.localeCompare(b.nom, 'fr', { numeric: true });
    });
    d.enfants.forEach(function (e) { if (e.genre === 'dossier') trier(e); });
  }
  function ouvrirTout(d) { d.ouvert = true; d.enfants.forEach(function (e) { if (e.genre === 'dossier') ouvrirTout(e); }); }

  // On ne lit que les 64 premiers octets et les 0x28 derniers (pour le pied des BCLIM), par lots.
  function reconnaitre(fichiers) {
    var i = 0, actifs = 0, fini, total = fichiers.length, dernierDessin = 0;
    return new Promise(function (resoudre) {
      fini = resoudre;
      function suivant() {
        while (actifs < 8 && i < total) {
          (function (f) {
            actifs++;
            var t = f.taille;
            // Petit fichier : on le lit en entier. Gros : les 64 premiers octets et les 0x28 derniers.
            (t <= 4096 ? lireTranche(f.fichier, 0, t).then(function (o) { return [o, undefined]; })
              : Promise.all([lireTranche(f.fichier, 0, 64), lireTranche(f.fichier, t - 0x28, t)]))
              .then(function (r) {
                f.nature = F.nature(r[0], f.nom, t, r[1]);
                f.lz = f.nature.type === 'lz11';
              })
              .catch(function (e) { f.erreur = 'Le fichier n\'a pas pu être lu : ' + e.message + '.'; })
              .then(function () {
                actifs--; stats.lus++;
                var maintenant = performance.now();
                if (maintenant - dernierDessin > 120 || stats.lus === total) { dernierDessin = maintenant; majInventaire(); aplatir(); dessinerArbre(); if (courant) dessinerFiche(); }
                if (stats.lus === total) fini(); else suivant();
              });
          })(fichiers[i++]);
        }
      }
      if (!total) fini(); else suivant();
    });
  }

  function majInventaire() {
    var el = $('#inventaire');
    if (!racine) { el.textContent = 'La réserve est vide.'; return; }
    var t = nombre(stats.fichiers) + ' fiche' + (stats.fichiers > 1 ? 's' : '') + ' dans ' + nombre(stats.dossiers + 1) + ' tiroir' + (stats.dossiers ? 's' : '') + ', ' + taille(stats.octets) + '.';
    if (stats.lus < stats.fichiers) t += ' <span class="pale">Lecture des en-têtes : ' + nombre(stats.lus) + ' sur ' + nombre(stats.fichiers) + '.</span>';
    el.innerHTML = '<code>' + echapper(racine.nom) + '/</code> ' + t;
  }

  // ---- les trois façons d'arriver : glisser, champ de fichiers, sélecteur de dossier

  function depuisEntrees(entrees) {
    var liste = [];
    function lireDossier(dir, prefixe) {
      return new Promise(function (resoudre, rejeter) {
        var lecteur = dir.createReader(), tous = [];
        (function encore() {
          lecteur.readEntries(function (lot) {
            if (!lot.length) {
              Promise.all(tous.map(function (e) { return parcourir(e, prefixe); })).then(resoudre, rejeter);
              return;
            }
            tous = tous.concat(Array.prototype.slice.call(lot));
            encore();
          }, rejeter);
        })();
      });
    }
    function parcourir(e, prefixe) {
      var ch = prefixe ? prefixe + '/' + e.name : e.name;
      if (e.isFile) return new Promise(function (r, j) { e.file(function (f) { liste.push({ chemin: ch, fichier: f }); r(); }, j); });
      if (e.isDirectory) return lireDossier(e, ch);
      return Promise.resolve();
    }
    return Promise.all(entrees.map(function (e) { return parcourir(e, ''); })).then(function () { return liste; });
  }

  function depuisPoignee(dir) {
    var liste = [];
    function parcourir(h, prefixe) {
      var ch = prefixe ? prefixe + '/' + h.name : h.name;
      if (h.kind === 'file') return h.getFile().then(function (f) { liste.push({ chemin: ch, fichier: f }); });
      var promesses = [];
      return (async function () {
        for await (var enfant of h.values()) promesses.push(parcourir(enfant, ch));
        await Promise.all(promesses);
      })();
    }
    return parcourir(dir, '').then(function () { return liste; });
  }

  function depuisChamp(fichiers) {
    return Array.prototype.map.call(fichiers, function (f) { return { chemin: f.webkitRelativePath || f.name, fichier: f }; });
  }

  function brancherChargement() {
    var profondeur = 0;
    document.addEventListener('dragenter', function (e) { if (aDesFichiers(e)) { profondeur++; document.body.classList.add('survol'); } });
    document.addEventListener('dragleave', function () { if (--profondeur <= 0) { profondeur = 0; document.body.classList.remove('survol'); } });
    document.addEventListener('dragover', function (e) { if (aDesFichiers(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    document.addEventListener('drop', function (e) {
      e.preventDefault(); profondeur = 0; document.body.classList.remove('survol');
      var items = e.dataTransfer.items, entrees = [];
      if (items) for (var i = 0; i < items.length; i++) { var en = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry(); if (en) entrees.push(en); }
      if (entrees.length) depuisEntrees(entrees).then(charger, function (er) { parler('Le dépôt n\'a pas pu être lu : ' + er.message + '.'); });
      else if (e.dataTransfer.files.length) charger(depuisChamp(e.dataTransfer.files));
    });
    function aDesFichiers(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0; }

    $('#iDossier').addEventListener('change', function () { charger(depuisChamp(this.files)); this.value = ''; });
    $('#iFichiers').addEventListener('change', function () { charger(depuisChamp(this.files)); this.value = ''; });
    $('#bFichiers').addEventListener('click', function () { $('#iFichiers').click(); });
    $('#bDossier').addEventListener('click', choisirDossier);
  }

  function choisirDossier() {
    if (window.showDirectoryPicker) {
      window.showDirectoryPicker({ id: 'romfs', mode: 'read' }).then(depuisPoignee).then(charger, function (e) {
        if (e && e.name === 'AbortError') return;
        $('#iDossier').click();         // sélecteur refusé (fichier local, navigateur prudent) : le champ classique
      });
    } else $('#iDossier').click();
  }

  // ================================================================ l'arbre

  var HAUTEURS = { tiroir: 34, boite: 30, fiche: 25 };
  function sorte(n) { return n.genre === 'dossier' ? 'tiroir' : estBoite(n) ? 'boite' : n.genre === 'groupe' ? 'groupe' : 'fiche'; }
  function hauteur(n) { var s = sorte(n); return s === 'groupe' ? HAUTEURS.fiche : HAUTEURS[s]; }

  function filtreActif() { return !!filtreNom || filtreTypes.size > 0; }
  var GROUPES_FILTRE = [
    { id: 'garc', mot: 'GARC', forme: 'garc' }, { id: 'lz11', mot: 'LZ', forme: 'lz11' }, { id: 'texte', mot: 'texte', forme: 'texte' },
    { id: 'bch', mot: 'BCH', forme: 'bch' }, { id: 'bclim', mot: 'image', forme: 'bclim' }, { id: 'mini', mot: 'paquet', forme: 'mini' },
    { id: 'autre', mot: 'autre', forme: 'inconnu' }, { id: 'illisible', mot: 'illisible', forme: 'illisible' }
  ];
  function typesDe(n) {
    var t = [];
    if (n.erreur) t.push('illisible');
    if (n.nature) t.push(n.nature.type);
    if (n.interne) t.push(n.interne.type);
    if (n.contient) n.contient.forEach(function (x) { t.push(x); });
    return t.map(function (x) { return x === 'connu' || x === 'inconnu' || x === 'vide' ? 'autre' : x; });
  }
  function correspondSeul(n) {
    if (filtreTypes.size) {
      var ok = typesDe(n).some(function (t) { return filtreTypes.has(t); });
      if (!ok) return false;
    }
    if (filtreNom && chemin(n).toLowerCase().indexOf(filtreNom) < 0) return false;
    return true;
  }

  function aplatir() {
    lignes = []; hauts = []; hautTotal = 0;
    if (!racine) return;
    var filtre = filtreActif(), memo = new Map();
    function garde(n) {
      if (!filtre) return true;
      if (memo.has(n)) return memo.get(n);
      var r = n.genre !== 'dossier' && n.genre !== 'groupe' && correspondSeul(n);
      if (!r && n.enfants) for (var i = 0; i < n.enfants.length && !r; i++) r = garde(n.enfants[i]);
      memo.set(n, r);
      return r;
    }
    function pousser(n, prof) {
      lignes.push({ n: n, prof: prof }); hauts.push(hautTotal); hautTotal += hauteur(n);
      var deplie = n.enfants && (n.ouvert || (filtre && n.genre === 'dossier'));
      if (deplie) n.enfants.forEach(function (e) { if (garde(e)) pousser(e, prof + 1); });
    }
    pousser(racine, 0);
    $('#arbreContenu').style.height = hautTotal + 'px';
  }

  function indiceA(y) {
    var a = 0, b = hauts.length - 1;
    while (a < b) { var m = (a + b + 1) >> 1; if (hauts[m] <= y) a = m; else b = m - 1; }
    return a;
  }

  function motNature(n) {
    if (n.erreur) return 'illisible';
    var nat = n.nature, t = typeDe(n);
    if (!nat) return t === 'attente' ? '…' : '';
    if (nat.type === 'lz11') return n.interne ? 'LZ › ' + PETITS[n.interne.type] : 'LZ11';
    return PETITS[t] || t;
  }

  function htmlLigne(l, i) {
    var n = l.n, s = sorte(n), sel = n === courant, h = hauteur(n);
    var cls = 'ligne l-' + s + (sel ? ' sel' : '') + (n.ouvert ? ' ouvert' : '') + (n.erreur ? ' illisible' : '');
    var aria = ' role="treeitem" aria-level="' + (l.prof + 1) + '" aria-selected="' + sel + '"' + (estConteneur(n) ? ' aria-expanded="' + !!n.ouvert + '"' : '');
    var out = '<div class="' + cls + '" id="r' + n.id + '" data-i="' + i + '"' + aria + ' style="top:' + hauts[i] + 'px;height:' + h + 'px">' +
      '<span class="rail" style="width:' + l.prof * 12 + 'px"></span>';
    var fleche = '<span class="fleche" aria-hidden="true">' + (n.ouvert ? '▾' : '▸') + '</span>';
    if (s === 'tiroir') {
      var nd = 0, nf = 0;
      n.enfants.forEach(function (e) { if (e.genre === 'dossier') nd++; else nf++; });
      var compte = [nd ? nd + ' tiroir' + (nd > 1 ? 's' : '') : '', nf ? nf + ' fiche' + (nf > 1 ? 's' : '') : ''].filter(Boolean).join(' et ') || 'vide';
      out += '<span class="facade">' + fleche + '<span class="porte-etiquette"><span class="carte">' + echapper(n.nom) + '</span></span><span class="compte">' + compte + '</span><span class="poignee"></span></span>';
    } else if (s === 'boite') {
      var nat = n.interne || n.nature, c;
      var k = nat.nombre;
      c = k === null || k === undefined ? 'GARC' : nombre(k) + (nat.type === 'garc' ? ' numéro' : ' fichier') + (k > 1 ? 's' : '');
      if (n.nature.type === 'lz11') c += ', compressé';
      out += '<span class="facade">' + fleche + '<span class="prise"></span><span class="etiquette">' + echapper(n.nom) + '</span><span class="compte">' + c + ', ' + taille(n.taille) + '</span>' + miniTampon(typeDe(n)) + '</span>';
    } else if (s === 'groupe') {
      out += '<span class="facade">' + fleche + '<span class="nom">' + echapper(n.nom) + '</span><span class="mot">' + n.enfants.length + ' sous-fichiers</span></span>';
    } else {
      out += '<span class="facade">' + miniTampon(typeDe(n)) + '<span class="nom">' + echapper(n.nom) + '</span><span class="mot">' + motNature(n) + '</span><span class="taille">' + taille(n.taille) + '</span></span>';
    }
    return out + '</div>';
  }

  var dessinPrevu = false;
  function dessinerArbre() {
    var arbre = $('#arbre'), cont = $('#arbreContenu');
    document.body.classList.toggle('vide', !racine);
    if (!racine) {
      cont.style.height = 'auto';
      cont.className = 'arbre-contenu vide-meuble';
      var vides = '';
      for (var k = 0; k < 4; k++) vides += '<div class="ligne l-tiroir" aria-hidden="true"><span class="facade"><span class="fleche"></span><span class="porte-etiquette"><span class="carte">&nbsp;</span></span><span class="compte"></span><span class="poignee"></span></span></div>';
      cont.innerHTML = vides + '<p class="note">Le meuble est vide. Glisse le dossier <code>romfs/</code> n\'importe où sur la page.</p>';
      return;
    }
    cont.className = 'arbre-contenu';
    var haut = arbre.scrollTop, bas = haut + arbre.clientHeight;
    var a = Math.max(0, indiceA(haut) - 6), b = Math.min(lignes.length - 1, indiceA(bas) + 6), html = '';
    for (var i = a; i <= b; i++) html += htmlLigne(lignes[i], i);
    cont.innerHTML = html;
    if (courant) arbre.setAttribute('aria-activedescendant', 'r' + courant.id);
  }
  function redessiner() { if (dessinPrevu) return; dessinPrevu = true; requestAnimationFrame(function () { dessinPrevu = false; dessinerArbre(); }); }

  function indiceDe(n) { for (var i = 0; i < lignes.length; i++) if (lignes[i].n === n) return i; return -1; }
  function montrer(n) {
    var i = indiceDe(n), arbre = $('#arbre');
    if (i < 0) return;
    var y = hauts[i], h = hauteur(n);
    if (y < arbre.scrollTop) arbre.scrollTop = y;
    else if (y + h > arbre.scrollTop + arbre.clientHeight) arbre.scrollTop = y + h - arbre.clientHeight;
  }

  // Ouvre ou ferme un tiroir, une boîte, un groupe. Une boîte s'ouvre la première fois en lisant le GARC.
  function basculer(n, forcer) {
    if (!estConteneur(n) && !(n.nature && n.nature.type === 'lz11' && !n.interne)) return Promise.resolve();
    var ouvrir = forcer === undefined ? !n.ouvert : forcer;
    if (!ouvrir) { n.ouvert = false; aplatir(); redessiner(); return Promise.resolve(); }
    return deballer(n).then(function () {
      if (!estConteneur(n)) return;
      n.ouvert = true; aplatir(); redessiner();
    });
  }

  function deballer(n) {
    if (n.enfants || n.genre === 'dossier' || n.genre === 'groupe') return Promise.resolve();
    if (n._deballage) return n._deballage;
    n._deballage = contenu(n).then(function (c) {
      var t = typeDe(n);
      try {
        if (t === 'garc') {
          var g = F.garc.lire(c);
          n.enfants = g.entrees.map(function (sous, i) {
            var nom = pad(i, 4);
            if (sous.length === 1) return piece(nom, sous[0], n);
            if (sous.length === 0) return piece(nom, new Uint8Array(0), n);
            var grp = noeud('groupe', nom, n, { enfants: [] });
            grp.enfants = sous.map(function (f, j) { return piece(nom + '.' + pad(j, 2), f, grp); });
            return grp;
          });
        } else if (t === 'mini') {
          var m = F.mini.lire(c);
          n.enfants = m.fichiers.map(function (f, k) { return piece(pad(k, 4), f, n); });
        }
      } catch (e) {
        n.erreur = 'Le conteneur n\'a pas pu être ouvert : ' + e.message + '.';
        n.enfants = null;
      }
      if (n.enfants) classerEnFond(n.enfants);
    }, function () { /* l'erreur est déjà notée sur le nœud */ }).then(function () { n._deballage = null; aplatir(); redessiner(); if (courant === n) dessinerFiche(); });
    return n._deballage;
  }

  function piece(nom, octets, parent) {
    var p = noeud('piece', nom, parent, { brut: octets, taille: octets.length });
    p.nature = F.nature(octets, nom);
    return p;
  }

  // Les pièces compressées : on les décompresse en fond, par petites tranches, pour savoir ce qu'elles
  // contiennent (texte, BCH, paquet...). Les très grosses attendent qu'on les ouvre.
  var fileFond = [], fondActif = false;
  function classerEnFond(pieces) {
    pieces.forEach(function (p) {
      if (p.genre === 'groupe') { classerEnFond(p.enfants); return; }
      if (p.nature && p.nature.type === 'lz11' && p.nature.tailleDecompressee <= 4 * 1048576) fileFond.push(p);
    });
    if (!fondActif) { fondActif = true; setTimeout(tourFond, 0); }
  }
  function tourFond() {
    var t0 = performance.now(), touche = false;
    while (fileFond.length && performance.now() - t0 < 10) {
      var p = fileFond.shift();
      if (p.interne || p.erreur) continue;
      try { var c = F.lz11.decompresser(p.brut); p.interne = F.nature(c, p.nom); p.tailleContenu = c.length; }
      catch (e) { p.erreur = 'La décompression a échoué : ' + e.message + '.'; }
      touche = true;
    }
    if (touche) { if (filtreActif()) aplatir(); redessiner(); }
    if (fileFond.length) setTimeout(tourFond, 0); else fondActif = false;
  }

  function brancherArbre() {
    var arbre = $('#arbre');
    arbre.addEventListener('scroll', redessiner);
    window.addEventListener('resize', redessiner);
    arbre.addEventListener('click', function (e) {
      var el = e.target.closest('.ligne');
      if (!el || !racine) return;
      var l = lignes[+el.dataset.i];
      if (!l) return;
      var n = l.n;
      selectionner(n);
      if (estConteneur(n) || (n.nature && n.nature.type === 'lz11' && !n.interne)) {
        // Un clic sur une pièce déjà choisie ne la referme pas ; un clic sur un tiroir l'ouvre ou le ferme.
        if (n.genre === 'dossier' || n.genre === 'groupe' || estBoite(n)) basculer(n);
      }
      arbre.focus({ preventScroll: true });
    });
    arbre.addEventListener('keydown', function (e) {
      if (!racine) return;
      var i = courant ? indiceDe(courant) : 0, n = courant;
      var cible = null;
      switch (e.key) {
        case 'ArrowDown': cible = lignes[Math.min(lignes.length - 1, i + 1)]; break;
        case 'ArrowUp': cible = lignes[Math.max(0, i - 1)]; break;
        case 'Home': cible = lignes[0]; break;
        case 'End': cible = lignes[lignes.length - 1]; break;
        case 'PageDown': cible = lignes[Math.min(lignes.length - 1, i + 15)]; break;
        case 'PageUp': cible = lignes[Math.max(0, i - 15)]; break;
        case 'ArrowRight':
          if (n && estConteneur(n) && !n.ouvert) basculer(n, true);
          else if (n && n.ouvert && lignes[i + 1]) cible = lignes[i + 1];
          break;
        case 'ArrowLeft':
          if (n && n.ouvert) basculer(n, false);
          else if (n && n.parent) { selectionner(n.parent); montrer(n.parent); }
          break;
        case 'Enter': case ' ':
          if (n && estConteneur(n)) basculer(n);
          break;
        default: return;
      }
      e.preventDefault();
      if (cible) { selectionner(cible.n); montrer(cible.n); }
    });

    // Filtres : par nom (chemin) et par nature (tampons).
    var filtres = $('#filtres');
    filtres.innerHTML = GROUPES_FILTRE.map(function (g) {
      return '<button type="button" class="filtre" aria-pressed="false" data-t="' + g.id + '" title="Ne montrer que : ' + g.mot + '">' + miniTampon(g.forme) + g.mot + '</button>';
    }).join('');
    filtres.addEventListener('click', function (e) {
      var b = e.target.closest('.filtre');
      if (!b) return;
      var t = b.dataset.t, on = !filtreTypes.has(t);
      if (on) filtreTypes.add(t); else filtreTypes.delete(t);
      b.setAttribute('aria-pressed', on);
      $('#noteFiltre').hidden = !filtreTypes.size;
      aplatir(); $('#arbre').scrollTop = 0; dessinerArbre();
    });
    var minuterie;
    $('#filtreNom').addEventListener('input', function () {
      var v = this.value.trim().toLowerCase();
      clearTimeout(minuterie);
      minuterie = setTimeout(function () { filtreNom = v; aplatir(); $('#arbre').scrollTop = 0; dessinerArbre(); }, 120);
    });
  }

  // ================================================================ la fiche

  var vue = null;                 // l'onglet choisi
  var jetonAffichage = 0;
  var controleur3D = null;

  function selectionner(n) {
    if (courant === n) { redessiner(); return; }
    courant = n;
    redessiner();
    afficher(n);
  }

  function natureLisible(n) {
    if (n.genre === 'dossier') return 'Tiroir : ' + n.enfants.length + ' élément' + (n.enfants.length > 1 ? 's' : '') + '.';
    if (n.genre === 'groupe') return 'Numéro de GARC à ' + n.enfants.length + ' sous-fichiers.';
    if (!n.nature) return 'En cours de lecture.';
    var t = n.nature.libelle;
    if (n.interne) t += ' Dedans : ' + n.interne.libelle.charAt(0).toLowerCase() + n.interne.libelle.slice(1);
    return t;
  }

  function dessinerFiche() {
    var fiche = $('#fiche');
    if (!racine) {
      fiche.innerHTML = '<div class="cote">Rien n\'est encore inventorié</div>' +
        '<div class="accueil-texte"><p>Glisse ici le dossier <code>romfs/</code> d\'un jeu 3DS, un GARC seul ou n\'importe quel fichier&nbsp;: l\'explorateur les reconnaît à leur magic, ouvre les GARC, décompresse le LZ11, décode les textes de Pokémon X/Y et montre images et modèles.</p>' +
        '<p>Le romfs sort de <code>python outils/extraire.py</code> dans le carnet <a href="../decompil-3ds/index.html">Décompil 3DS</a>, qui le pose dans <code>local/extrait/romfs/</code>. Rien ne quitte ton navigateur&nbsp;: les fichiers sont lus sur place, rien n\'est envoyé.</p></div>';
      return;
    }
    var n = courant;
    if (!n) { fiche.innerHTML = ''; return; }
    var t = typeDe(n), tampons = '';
    if (n.genre === 'fichier' || n.genre === 'piece') {
      if (n.nature && n.nature.type === 'lz11') {
        tampons = grandTampon('lz11', n.nature.variante) + (n.erreur ? grandTampon('illisible') : n.interne ? grandTampon(n.interne.type) : '');
      } else tampons = grandTampon(t);
    }
    var tailleTxt = '';
    if (n.genre === 'fichier' || n.genre === 'piece') {
      tailleTxt = octetsEnToutes(n.taille);
      if (n.nature && n.nature.type === 'lz11') tailleTxt += ' compressés, ' + octetsEnToutes(n.tailleContenu || n.nature.tailleDecompressee) + ' décompressés';
    }
    var html = '<div class="cote" title="La cote de la pièce : son chemin dans le romfs">' + echapper(chemin(n) || n.nom) + (n.genre === 'dossier' ? '/' : '') + '</div><dl>' +
      '<dt>Nature</dt><dd>' + echapper(natureLisible(n)) + '</dd>' +
      (tailleTxt ? '<dt>Taille</dt><dd>' + tailleTxt + '</dd>' : '') +
      (n.erreur ? '<dt>Lecture</dt><dd class="erreur">✗ ' + echapper(n.erreur) + '</dd>' : '') +
      '</dl><div class="tampons">' + tampons + '</div><div class="actions">';
    if (n.genre === 'fichier' || n.genre === 'piece') {
      var lz = n.nature && n.nature.type === 'lz11';
      if (!(lz && n.erreur)) html += '<button type="button" class="ticket" data-act="telecharger">' + (lz ? 'Télécharger, décompressé' : 'Télécharger') + '</button>';
      if (lz) html += '<button type="button" class="ticket" data-act="brut">Télécharger tel quel</button>';
      if (estBoite(n)) html += '<button type="button" class="ticket" data-act="zip">Télécharger éclaté en zip</button>';
      if (t === 'texte') html += '<button type="button" class="ticket" data-act="txt">Télécharger le texte (.txt)</button>';
      if (t === 'bclim') html += '<button type="button" class="ticket" data-act="png">Télécharger en PNG</button>';
    } else if (n.genre === 'groupe') {
      html += '<button type="button" class="ticket" data-act="zip">Télécharger les sous-fichiers en zip</button>';
    }
    fiche.innerHTML = html + '</div>';
  }

  // ================================================================ la table d'examen

  var ONGLETS = { bordereau: 'Bordereau', texte: 'Texte', image: 'Image', modele: 'Modèle 3D', hex: 'Hexadécimal', recherche: 'Recherche' };
  var dernierResultat = null;

  function ongletsPour(n) {
    if (!n) return [];
    if (n.genre === 'dossier' || n.genre === 'groupe') return ['bordereau'];
    var t = typeDe(n);
    if (t === 'garc' || t === 'mini') return ['bordereau', 'hex'];
    if (t === 'texte') return ['texte', 'hex'];
    if (t === 'bclim') return ['image', 'hex'];
    if (t === 'bch') return ['modele', 'hex', 'image'];
    return ['hex', 'image'];
  }

  function afficher(n, options) {
    options = options || {};
    var jeton = ++jetonAffichage;
    arreter3D();
    dessinerFiche();
    var pret = (n.genre === 'fichier' || n.genre === 'piece') ? contenu(n).catch(function () { return null; }) : Promise.resolve(null);
    pret.then(function (c) {
      if (jeton !== jetonAffichage) return;
      if (estBoite(n) && !n.enfants) return deballer(n).then(function () { return c; });
      return c;
    }).then(function (c) {
      if (jeton !== jetonAffichage) return;
      dessinerFiche(); redessiner();
      var dispo = ongletsPour(n);
      var choix = options.vue && dispo.indexOf(options.vue) >= 0 ? options.vue : dispo[0];
      vue = choix;
      dessinerOnglets(dispo);
      dessinerVue(n, c, options);
    });
  }

  function dessinerOnglets(dispo) {
    var avec = dispo.slice();
    if (dernierResultat && avec.indexOf('recherche') < 0) avec.push('recherche');
    $('#onglets').innerHTML = avec.map(function (o) {
      var txt = ONGLETS[o] + (o === 'recherche' && dernierResultat ? ' (' + nombre(dernierResultat.trouves.length) + ')' : '');
      return '<button type="button" role="tab" class="onglet" data-vue="' + o + '" aria-selected="' + (o === vue) + '">' + txt + '</button>';
    }).join('');
  }

  function brancherTable() {
    $('#onglets').addEventListener('click', function (e) {
      var b = e.target.closest('.onglet');
      if (!b) return;
      if (b.dataset.vue === 'recherche') { montrerRecherche(); return; }
      if (!courant) return;
      arreter3D();
      vue = b.dataset.vue;
      dessinerOnglets(ongletsPour(courant));
      var n = courant;
      ((n.genre === 'fichier' || n.genre === 'piece') ? contenu(n).catch(function () { return null; }) : Promise.resolve(null)).then(function (c) { if (courant === n) dessinerVue(n, c, {}); });
    });
    $('#fiche').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b || !courant) return;
      exporter(courant, b.dataset.act);
    });
  }

  function dessinerVue(n, c, options) {
    var releve = $('#releve');
    releve.innerHTML = '';
    if (vue === 'bordereau') return vueBordereau(releve, n);
    if (c === null && (n.genre === 'fichier' || n.genre === 'piece')) {
      releve.innerHTML = '<p class="parole"><span class="rouge">✗ Illisible.</span> ' + echapper(n.erreur || 'Le contenu n\'a pas pu être lu.') + ' Voici le fichier tel qu\'il est sur le disque.</p>';
      octetsBruts(n).then(function (b) { if (courant === n) vueHex(releve, b); });
      return;
    }
    if (vue === 'texte') return vueTexte(releve, n, c, options);
    if (vue === 'hex') return vueHex(releve, c);
    if (vue === 'image') return vueImage(releve, n, c);
    if (vue === 'modele') return vueModele(releve, n, c);
  }

  // ---------------------------------------------------------------- bordereau

  function vueBordereau(releve, n) {
    var enfants = n.enfants || [];
    var div = document.createElement('div');
    div.className = 'defile';
    var lignesHtml = enfants.slice(0, 5000).map(function (e, i) {
      var t = typeDe(e), mot;
      if (e.genre === 'dossier') mot = e.enfants.length + ' élément' + (e.enfants.length > 1 ? 's' : '');
      else if (e.genre === 'groupe') mot = e.enfants.length + ' sous-fichiers';
      else mot = e.nature ? natureLisible(e) : 'en cours de lecture';
      var tl = e.genre === 'dossier' || e.genre === 'groupe' ? '' : taille(e.taille);
      return '<tr data-k="' + i + '"' + (e.erreur ? ' class="illisible"' : '') + '><td class="nom">' + (e.genre === 'dossier' || e.genre === 'groupe' ? '<svg aria-hidden="true"></svg>' : miniTampon(t)) + echapper(e.nom) + (e.genre === 'dossier' ? '/' : '') + '</td><td>' + echapper(mot) + '</td><td class="t">' + tl + '</td></tr>';
    }).join('');
    var plus = enfants.length > 5000 ? '<p class="parole">Les ' + nombre(enfants.length - 5000) + ' suivants sont dans le meuble.</p>' : '';
    div.innerHTML = '<table class="bordereau"><thead><tr><th scope="col">Cote</th><th scope="col">Nature</th><th scope="col">Taille</th></tr></thead><tbody>' + lignesHtml + '</tbody></table>' + plus;
    if (!enfants.length) div.innerHTML = '<p class="parole">' + (n.erreur ? '<span class="rouge">✗ ' + echapper(n.erreur) + '</span>' : 'Rien dedans.') + '</p>';
    releve.appendChild(div);
    div.addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-k]');
      if (!tr) return;
      var cible = enfants[+tr.dataset.k];
      basculer(n, true).then(function () { selectionner(cible); montrer(cible); });
    });
  }

  // ---------------------------------------------------------------- texte

  var LANGUES_XY = ['japonais en kana', 'japonais en kanji', 'anglais', 'français', 'italien', 'allemand', 'espagnol', 'coréen'];

  function lignesDe(n, c) {
    if (!n._lignes) n._lignes = F.texte.decoder(c);
    return n._lignes;
  }

  // Les « langues » possibles d'un texte : les sous-fichiers du même numéro s'ils sont tous des textes
  // de même longueur, ou les GARC frères du même tiroir (X/Y range une langue par GARC, a/0/7/2 à 9
  // et a/0/8/0 à 7 d'après pk3DS ; l'ordre des langues reste à vérifier sur le romfs).
  function languesDe(n) {
    var p = n.parent;
    if (p && p.genre === 'groupe' && p.enfants.length > 1 && p.enfants.every(function (e) { return typeDe(e) === 'texte'; })) {
      var nl = p.enfants.map(function (e) { return (e.interne || e.nature).lignes; });
      if (nl.every(function (x) { return x === nl[0]; })) return { genre: 'groupe', choix: p.enfants.map(function (e) { return { etiquette: 'sous-fichier ' + e.nom.slice(-2), cible: e }; }) };
    }
    var garc = p && p.genre === 'groupe' ? p.parent : p;
    if (!garc || garc.genre !== 'fichier' || !garc.parent) return null;
    var freres = garc.parent.enfants.filter(function (e) { return e.genre === 'fichier' && typeDe(e) === 'garc'; });
    // X/Y : gametext en a/0/7/2 à a/0/7/9, storytext en a/0/8/0 à a/0/8/7 (pk3DS, GARCReference.cs).
    var dossier = chemin(garc.parent), base = /(^|\/)a\/0\/7$/.test(dossier) ? 2 : /(^|\/)a\/0\/8$/.test(dossier) ? 0 : -1;
    if (base >= 0) {
      var famille = freres.filter(function (f) { var k = +f.nom - base; return /^\d$/.test(f.nom) && k >= 0 && k < 8; });
      if (famille.indexOf(garc) >= 0) freres = famille; else base = -1;
    }
    if (freres.length < 2) return null;
    return {
      genre: 'freres', garc: garc,
      choix: freres.map(function (f) {
        var e = 'GARC ' + chemin(f);
        if (base >= 0) e += ', ' + LANGUES_XY[+f.nom - base] + ' (supposé)';
        return { etiquette: e, garc: f };
      })
    };
  }

  function rendreLigneTexte(t, q) {
    // Les variables [VAR …], pauses [WAIT n], lignes vides [~ n] et échappements \n \r \c restent visibles.
    var html = '', re = /(\[(?:VAR|WAIT|~) [^\]]*\])|(\\[nrc\\[])/g, m, dernier = 0;
    function morceau(s) { return q ? surligner(s, q) : echapper(s); }
    while ((m = re.exec(t))) {
      html += morceau(t.slice(dernier, m.index));
      if (m[1]) html += '<span class="var">' + echapper(m[1]) + '</span>';
      else html += '<span class="cmd">' + echapper(m[2]) + '</span>' + (m[2] === '\\n' ? '\n' : '');
      dernier = re.lastIndex;
    }
    return html + morceau(t.slice(dernier));
  }

  function vueTexte(releve, n, c, options) {
    var lignesTxt;
    try { lignesTxt = lignesDe(n, c); }
    catch (e) {
      n.erreur = 'Le texte n\'a pas pu être décodé : ' + e.message + '.';
      dessinerFiche(); redessiner();
      releve.innerHTML = '<p class="parole"><span class="rouge">✗ Illisible.</span> ' + echapper(n.erreur) + '</p><pre class="hex-tete"></pre>';
      releve.querySelector('.hex-tete').textContent = hexTete(c, 256);
      return;
    }
    var barre = document.createElement('div');
    barre.className = 'barre';
    var langues = languesDe(n);
    var txt = '<span>' + nombre(lignesTxt.length) + ' ligne' + (lignesTxt.length > 1 ? 's' : '') + '</span>';
    if (langues) {
      txt += '<label>Langue <select id="langue">' + langues.choix.map(function (ch, k) {
        var sel = langues.genre === 'groupe' ? ch.cible === n : ch.garc === langues.garc;
        return '<option value="' + k + '"' + (sel ? ' selected' : '') + '>' + echapper(ch.etiquette) + '</option>';
      }).join('') + '</select></label>';
    }
    txt += '<span class="note">Variables et commandes telles que pk3DS les écrit.</span>';
    barre.innerHTML = txt;
    releve.appendChild(barre);
    var defile = document.createElement('div');
    defile.className = 'defile';
    var q = options.surligne || '';
    defile.innerHTML = '<div class="texte">' + lignesTxt.map(function (t, i) {
      return '<div class="l' + (options.ligne === i ? ' vise' : '') + '"><span class="n">' + i + '</span><span class="t">' + rendreLigneTexte(t, q) + '</span></div>';
    }).join('') + '</div>';
    releve.appendChild(defile);
    if (options.scroll) defile.scrollTop = options.scroll;
    if (options.ligne !== undefined) {
      var vise = defile.querySelector('.vise');
      if (vise) defile.scrollTop = Math.max(0, vise.offsetTop - defile.clientHeight / 3);
    }
    if (langues) {
      barre.querySelector('#langue').addEventListener('change', function () {
        var ch = langues.choix[+this.value], suite = { vue: 'texte', ligne: undefined };
        suite.scroll = defile.scrollTop;
        if (langues.genre === 'groupe') { selectionnerAvec(ch.cible, suite); return; }
        // Même numéro (et même sous-fichier) dans le GARC frère.
        var rel = [], p = n;
        while (p && p !== langues.garc) { rel.unshift(p.nom); p = p.parent; }
        ouvrirChemin(ch.garc, rel).then(function (cible) {
          if (cible) selectionnerAvec(cible, suite);
          else releve.querySelector('.note').textContent = 'Le GARC ' + chemin(ch.garc) + ' n\'a pas de numéro ' + rel.join(' › ') + '.';
        });
      });
    }
  }

  function selectionnerAvec(n, options) {
    courant = n;
    montrer(n); redessiner();
    afficher(n, options);
  }

  // Ouvre une boîte (et son groupe) et rend la pièce désignée par ses noms relatifs.
  function ouvrirChemin(boite, noms) {
    return basculer(boite, true).then(function () {
      var p = boite, k = 0;
      function pas() {
        if (k >= noms.length) return Promise.resolve(p);
        var e = (p.enfants || []).filter(function (x) { return x.nom === noms[k]; })[0];
        if (!e) return Promise.resolve(null);
        k++;
        p = e;
        return (estConteneur(e) && k < noms.length ? basculer(e, true) : Promise.resolve()).then(pas);
      }
      return pas();
    });
  }

  // ---------------------------------------------------------------- hexadécimal

  function hexTete(o, max) {
    var t = '', n = Math.min(o.length, max);
    for (var a = 0; a < n; a += 16) t += ligneHex(o, a, true) + '\n';
    if (o.length > max) t += '…';
    return t;
  }
  var HEX = []; for (var hx = 0; hx < 256; hx++) HEX.push((hx < 16 ? '0' : '') + hx.toString(16).toUpperCase());
  function ligneHex(o, a, brut) {
    var h = '', c = '';
    for (var k = 0; k < 16; k++) {
      if (a + k < o.length) {
        var v = o[a + k], ch = String.fromCharCode(v);
        h += (v === 0 && !brut ? '<span class="z">00</span>' : HEX[v]) + (k === 7 ? '  ' : ' ');
        c += v >= 32 && v < 127 ? (brut ? ch : echapper(ch)) : '.';
      } else { h += '   ' + (k === 7 ? ' ' : ''); c += ' '; }
    }
    var adr = pad(a.toString(16).toUpperCase(), 8);
    if (brut) return adr + '  ' + h + ' ' + c;
    return '<span class="a">' + adr + '</span>  ' + h + ' <span class="c">' + c + '</span>';
  }

  function vueHex(releve, c) {
    var barre = document.createElement('div');
    barre.className = 'barre';
    var coupe = c.length > 1200000 * 16;
    barre.innerHTML = '<span>' + octetsEnToutes(c.length) + ', seize par ligne' + (coupe ? ' ; seuls les ' + nombre(1200000 * 16 / 1048576 | 0) + ' premiers Mio sont montrés, l\'export donne tout' : '') + '</span><label>Aller à <input type="text" id="allerA" placeholder="0x0" spellcheck="false" style="width:7em;font-family:var(--machine)"></label>';
    releve.appendChild(barre);
    var defile = document.createElement('div');
    defile.className = 'defile';
    var H = 20, MAX = 1200000, rangs = Math.min(Math.ceil(c.length / 16), MAX);
    var hex = document.createElement('div');
    hex.className = 'hex';
    hex.style.height = (rangs * H + 16) + 'px';
    defile.appendChild(hex);
    releve.appendChild(defile);
    function dessiner() {
      var a = Math.max(0, Math.floor(defile.scrollTop / H) - 4), b = Math.min(rangs, a + Math.ceil(defile.clientHeight / H) + 8), html = '';
      for (var r = a; r < b; r++) html += '<div class="r" style="top:' + (r * H + 6) + 'px">' + ligneHex(c, r * 16) + '</div>';
      hex.innerHTML = html;
    }
    var prevu = false;
    defile.addEventListener('scroll', function () { if (!prevu) { prevu = true; requestAnimationFrame(function () { prevu = false; dessiner(); }); } });
    dessiner();
    barre.querySelector('#allerA').addEventListener('change', function () {
      var v = parseInt(this.value.replace(/^0x/i, ''), 16);
      if (v >= 0) { defile.scrollTop = Math.floor(v / 16) * H; dessiner(); }
    });
  }

  // ---------------------------------------------------------------- image

  function vueImage(releve, n, c) {
    var t = typeDe(n), clim = t === 'bclim';
    var barre = document.createElement('div');
    barre.className = 'barre';
    var reglages = '';
    if (!clim) {
      reglages = '<label>Format <select id="tFormat">' + F.texture.FORMATS_PICA.map(function (f) { return '<option>' + f + '</option>'; }).join('') + '</select></label>' +
        '<label>Largeur <input type="number" id="tL" min="8" max="2048" step="8" value="64"></label>' +
        '<label>Hauteur <input type="number" id="tH" min="8" max="2048" step="8" value="64"></label>' +
        '<label>Décalage <input type="number" id="tD" min="0" step="16" value="0"></label>';
    }
    barre.innerHTML = '<span id="iInfo"></span>' + reglages +
      '<label class="coche"><input type="checkbox" id="iRetourne"><span>retourner</span></label>' +
      '<button type="button" class="ticket" id="iEnsemble" title="Vue d\'ensemble (touche 0)">Vue d\'ensemble</button>' +
      '<span class="echelle" id="iEchelle"></span>';
    releve.appendChild(barre);
    var visee = document.createElement('div');
    visee.className = 'visee';
    visee.tabIndex = 0;
    visee.setAttribute('aria-label', 'L\'image : molette pour zoomer, glisser pour déplacer, 0 pour la vue d\'ensemble');
    var toile = document.createElement('canvas');
    visee.appendChild(toile);
    releve.appendChild(visee);
    var info = barre.querySelector('#iInfo');
    var etat = { z: 1, x: 0, y: 0 };

    function appliquer() {
      etat.x = Math.round(etat.x); etat.y = Math.round(etat.y);
      toile.style.left = etat.x + 'px'; toile.style.top = etat.y + 'px';
      toile.style.width = toile.width * etat.z + 'px'; toile.style.height = toile.height * etat.z + 'px';
      barre.querySelector('#iEchelle').textContent = '×' + (etat.z >= 1 ? etat.z : etat.z.toFixed(2));
    }
    function ensemble() {
      var w = visee.clientWidth, h = visee.clientHeight;
      if (!toile.width) return;
      var z = Math.min((w - 24) / toile.width, (h - 24) / toile.height);
      z = z >= 1 ? Math.floor(z) : Math.pow(2, Math.floor(Math.log2(z)));
      z = Math.max(1 / 16, Math.min(64, z));
      etat.z = z; etat.x = (w - toile.width * z) / 2; etat.y = (h - toile.height * z) / 2;
      appliquer();
    }
    function rendre() {
      var rgba, L, H, txt;
      try {
        if (clim) {
          var im = F.bclim.lire(c);
          rgba = im.rgba; L = im.largeur; H = im.hauteur;
          txt = L + ' × ' + H + ' pixels, ' + im.format + ', stockée en ' + im.stockee;
        } else {
          var f = barre.querySelector('#tFormat').value;
          L = +barre.querySelector('#tL').value; H = +barre.querySelector('#tH').value;
          var d = +barre.querySelector('#tD').value || 0;
          rgba = F.texture.decoder(c.subarray(d), f, L, H);
          txt = 'Lu comme texture ' + f + ' à partir de 0x' + d.toString(16).toUpperCase();
        }
      } catch (e) {
        info.innerHTML = '<span class="erreur">✗ ' + echapper(e.message) + '</span>';
        toile.width = 0; toile.height = 0;
        return;
      }
      toile.width = L; toile.height = H;
      var ctx = toile.getContext('2d'), img = ctx.createImageData(L, H);
      if (barre.querySelector('#iRetourne').checked) {
        for (var y = 0; y < H; y++) img.data.set(rgba.subarray((H - 1 - y) * L * 4, (H - y) * L * 4), y * L * 4);
      } else img.data.set(rgba);
      ctx.putImageData(img, 0, 0);
      info.textContent = txt;
      ensemble();
    }
    if (!clim) {
      // Pour un BCH, une première proposition : rien de sûr, c'est un essai à la main.
      ['#tFormat', '#tL', '#tH', '#tD'].forEach(function (s) { barre.querySelector(s).addEventListener('change', rendre); });
    }
    barre.querySelector('#iRetourne').addEventListener('change', rendre);
    barre.querySelector('#iEnsemble').addEventListener('click', ensemble);
    brancherZoom(visee, etat, appliquer, ensemble);
    requestAnimationFrame(rendre);
  }

  // Zoom à la molette centré sur le curseur, déplacement au glisser, 0 pour la vue d'ensemble.
  function brancherZoom(visee, etat, appliquer, ensemble) {
    visee.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = visee.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      var avant = etat.z, z = avant;
      if (e.deltaY < 0) z = z >= 1 ? z + Math.max(1, Math.floor(z / 4)) : z * 2;
      else z = z > 1 ? z - Math.max(1, Math.floor(z / 5)) : z / 2;
      z = Math.max(1 / 16, Math.min(64, z));
      etat.x = mx - (mx - etat.x) * z / avant; etat.y = my - (my - etat.y) * z / avant; etat.z = z;
      appliquer();
    }, { passive: false });
    var tenu = null;
    visee.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 && e.button !== 1) return;
      e.preventDefault();
      tenu = { x: e.clientX - etat.x, y: e.clientY - etat.y };
      visee.setPointerCapture(e.pointerId); visee.classList.add('glisse'); visee.focus({ preventScroll: true });
    });
    visee.addEventListener('pointermove', function (e) { if (tenu) { etat.x = e.clientX - tenu.x; etat.y = e.clientY - tenu.y; appliquer(); } });
    function lacher() { tenu = null; visee.classList.remove('glisse'); }
    visee.addEventListener('pointerup', lacher); visee.addEventListener('pointercancel', lacher);
    visee.addEventListener('keydown', function (e) {
      if (e.key === '0') { ensemble(); e.preventDefault(); }
      if (e.key === '+' || e.key === '-') {
        var r = visee.getBoundingClientRect();
        visee.dispatchEvent(new WheelEvent('wheel', { deltaY: e.key === '+' ? -1 : 1, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, cancelable: true }));
      }
    });
    new ResizeObserver(function () { if (visee.isConnected) ensemble(); }).observe(visee);
  }

  // ---------------------------------------------------------------- modèle 3D

  function arreter3D() { if (controleur3D) { try { controleur3D.arreter(); } catch (e) { /* déjà arrêté */ } controleur3D = null; } }

  function vueModele(releve, n, c) {
    var pourquoi = null, modele = null;
    if (!window.BCH || typeof window.BCH.lire !== 'function') {
      pourquoi = 'La visionneuse BCH n\'est pas à côté : <code>../visionneuse-bch/bch.js</code> n\'a pas été trouvé, alors voici l\'en-tête du fichier.';
    } else {
      try { modele = window.BCH.lire(c); }
      catch (e) { pourquoi = 'La visionneuse BCH n\'a pas su lire ce modèle : ' + echapper(phrase(e.message)) + '. Voici l\'en-tête du fichier.'; }
    }
    if (pourquoi) {
      releve.innerHTML = '<p class="parole">' + pourquoi + '</p><pre class="hex-tete"></pre>';
      releve.querySelector('.hex-tete').textContent = hexTete(c, 256);
      return;
    }
    var barre = document.createElement('div');
    barre.className = 'barre';
    function compte(x, mot) { var k = x && x.length !== undefined ? x.length : x ? 1 : 0; return k + ' ' + mot + (k > 1 ? 's' : ''); }
    barre.innerHTML = '<span><strong>' + echapper(modele.nom || n.nom) + '</strong></span><span>' + [compte(modele.maillages, 'maillage'), compte(modele.textures, 'texture'), compte(modele.animations, 'animation')].join(', ') +
      (modele.squelette ? ', un squelette' : '') + '</span><button type="button" class="ticket" id="mEnsemble">Vue d\'ensemble</button>' +
      '<a class="note" href="../visionneuse-bch/index.html">Ouvrir la visionneuse BCH</a>';
    releve.appendChild(barre);
    var scene = document.createElement('div');
    scene.className = 'scene';
    var toile = document.createElement('canvas');
    scene.appendChild(toile);
    releve.appendChild(scene);
    if (modele.avertissements && modele.avertissements.length) {
      var av = document.createElement('div');
      av.className = 'avertissements';
      av.textContent = modele.avertissements.slice(0, 4).join(' ') + (modele.avertissements.length > 4 ? ' (et ' + (modele.avertissements.length - 4) + ' autres)' : '');
      releve.appendChild(av);
    }
    requestAnimationFrame(function () {
      toile.width = scene.clientWidth; toile.height = scene.clientHeight;
      try {
        controleur3D = window.BCH.rendre(toile, modele, {});
        controleur3D.demarrer();
      } catch (e) {
        scene.innerHTML = '<p class="parole"><span class="rouge">✗</span> Le rendu a échoué : ' + echapper(phrase(e.message)) + '.</p><pre class="hex-tete"></pre>';
        scene.querySelector('.hex-tete').textContent = hexTete(c, 256);
      }
    });
    barre.querySelector('#mEnsemble').addEventListener('click', function () { if (controleur3D) try { controleur3D.vue('ensemble'); } catch (e) { /* vue inconnue */ } });
  }

  // ================================================================ export

  function telecharger(morceaux, nom, type) {
    var url = URL.createObjectURL(new Blob(morceaux, { type: type || 'application/octet-stream' }));
    var a = document.createElement('a');
    a.href = url; a.download = nom;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  var EXTENSIONS = { garc: '.garc', texte: '.bin', bch: '.bch', bclim: '.bclim', mini: '.bin', lz11: '.lz' };
  function nomExport(n, ext) {
    var f = fichierPorteur(n), base = f ? chemin(f).replace(/\//g, '-') : n.nom;
    var dedans = n === f ? '' : chemin(n).slice(chemin(f).length).replace(/ › /g, '_');
    return (base + dedans).replace(/[\\:*?"<>|]/g, '_') + ext;
  }

  function exporter(n, act) {
    if (act === 'brut') { octetsBruts(n).then(function (b) { telecharger([b], nomExport(n, '.lz')); }); return; }
    if (act === 'telecharger') {
      contenu(n).then(function (c) { telecharger([c], nomExport(n, EXTENSIONS[typeDe(n)] || '.bin')); }, function () { dessinerFiche(); });
      return;
    }
    if (act === 'txt') {
      contenu(n).then(function (c) { telecharger([lignesDe(n, c).join('\n') + '\n'], nomExport(n, '.txt'), 'text/plain;charset=utf-8'); });
      return;
    }
    if (act === 'png') {
      contenu(n).then(function (c) {
        var im = F.bclim.lire(c), toile = document.createElement('canvas');
        toile.width = im.largeur; toile.height = im.hauteur;
        var ctx = toile.getContext('2d'), d = ctx.createImageData(im.largeur, im.hauteur);
        d.data.set(im.rgba); ctx.putImageData(d, 0, 0);
        toile.toBlob(function (b) { telecharger([b], nomExport(n, '.png'), 'image/png'); });
      });
      return;
    }
    if (act === 'zip') {
      var porteur = n;
      (n.genre === 'groupe' ? Promise.resolve() : deballer(n)).then(function () {
        var fichiers = [];
        (porteur.enfants || []).forEach(function (e) {
          var sous = e.genre === 'groupe' ? e.enfants : [e];
          sous.forEach(function (p, j) {
            var nom = e.genre === 'groupe' ? p.nom : (typeDe(n) === 'garc' ? p.nom + '.00' : p.nom);
            var o = p.brut, ext = '.bin';
            if (p.nature && p.nature.type === 'lz11') {
              try { o = F.lz11.decompresser(p.brut); } catch (er) { ext = '.lz'; }
            }
            var t = ext === '.lz' ? 'lz11' : F.nature(o, p.nom).type;
            if (ext !== '.lz') ext = EXTENSIONS[t] && t !== 'lz11' ? EXTENSIONS[t] : '.bin';
            fichiers.push({ nom: nom + ext, octets: o });
          });
        });
        if (!fichiers.length) return;
        telecharger(F.zip.ecrire(fichiers), nomExport(n, '.zip'), 'application/zip');
      });
    }
  }

  // ================================================================ recherche dans les textes

  var rechercheJeton = 0;
  function sansAccents(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function surligner(s, q) {
    if (!q) return echapper(s);
    var base = sansAccents(s), out = '', i = 0, k;
    // NFD peut changer les longueurs ; on ne surligne que si la correspondance caractère à caractère tient.
    if (base.length !== s.length) return echapper(s);
    while ((k = base.indexOf(q, i)) >= 0) { out += echapper(s.slice(i, k)) + '<mark>' + echapper(s.slice(k, k + q.length)) + '</mark>'; i = k + q.length; }
    return out + echapper(s.slice(i));
  }

  function textesConnus() {
    var r = [], fermees = [];
    (function parcours(n) {
      if (n.enfants) n.enfants.forEach(parcours);
      else if ((n.genre === 'fichier' || n.genre === 'piece') && typeDe(n) === 'texte') r.push(n);
      else if (n.genre === 'fichier' && typeDe(n) === 'garc' && !n.enfants) fermees.push(n);
      else if (n.genre === 'fichier' && n.nature && n.nature.type === 'lz11' && !n.interne) fermees.push(n);
    })(racine);
    return { textes: r, fermees: fermees };
  }

  function chercher(q, aussiFermes) {
    var jeton = ++rechercheJeton;
    var qn = sansAccents(q);
    var connus = textesConnus();
    var res = { q: q, qn: qn, trouves: [], lus: 0, total: connus.textes.length + (aussiFermes ? connus.fermees.length : 0), fini: false, textes: 0 };
    dernierResultat = res;
    montrerRecherche();
    var file = connus.textes.map(function (n) { return { n: n }; });
    if (aussiFermes) connus.fermees.forEach(function (n) { file.push({ boite: n }); });

    function chercherDans(lignesTxt, ou) {
      res.textes++;
      for (var i = 0; i < lignesTxt.length; i++) {
        if (sansAccents(lignesTxt[i]).indexOf(qn) >= 0) {
          res.trouves.push({ ou: ou, ligne: i, texte: lignesTxt[i] });
          if (res.trouves.length >= 5000) return true;
        }
      }
      return false;
    }

    (async function () {
      var t0 = performance.now();
      for (var k = 0; k < file.length; k++) {
        if (jeton !== rechercheJeton) return;
        var it = file[k], plein = false;
        try {
          if (it.n) {
            var c = await contenu(it.n);
            plein = chercherDans(lignesDe(it.n, c), { n: it.n });
          } else {
            // Un GARC encore fermé : on le lit, on cherche dans ses textes, on ne garde rien en mémoire.
            var b = await octetsBruts(it.boite);
            if (it.boite.nature && it.boite.nature.type === 'lz11') { b = F.lz11.decompresser(b); if (F.nature(b).type !== 'garc') b = null; }
            if (b && F.nature(b).type === 'garc') {
              var g = F.garc.lire(b);
              for (var i = 0; i < g.entrees.length && !plein; i++) {
                for (var j = 0; j < g.entrees[i].length && !plein; j++) {
                  var o = g.entrees[i][j];
                  if (F.lz11.estCompresse(o) && (o[1] | o[2] << 8 | o[3] << 16) <= 1048576) { try { o = F.lz11.decompresser(o); } catch (e) { continue; } }
                  if (!F.texte.estPlausible(o)) continue;
                  var noms = g.entrees[i].length === 1 ? [pad(i, 4)] : [pad(i, 4), pad(i, 4) + '.' + pad(j, 2)];
                  (it.boite.contient = it.boite.contient || new Set()).add('texte');
                  try { plein = chercherDans(F.texte.decoder(o), { boite: it.boite, noms: noms }); } catch (e) { /* texte abîmé : on passe */ }
                  if (performance.now() - t0 > 14) { await pause(); t0 = performance.now(); if (jeton !== rechercheJeton) return; }
                }
              }
            }
          }
        } catch (e) { /* illisible : on continue */ }
        res.lus++;
        if (plein) break;
        if (performance.now() - t0 > 14) { majRecherche(); await pause(); t0 = performance.now(); }
      }
      res.fini = true;
      if (jeton === rechercheJeton) majRecherche();
    })();
  }

  function montrerRecherche() {
    if (!dernierResultat) return;
    arreter3D();
    vue = 'recherche';
    dessinerOnglets(ongletsPour(courant));
    var releve = $('#releve');
    releve.innerHTML = '<div class="barre" id="rBarre"></div><div class="defile"><ol class="resultats" id="rListe"></ol></div>';
    releve.querySelector('#rListe').addEventListener('click', function (e) {
      var li = e.target.closest('li[data-k]');
      if (li) allerAuResultat(dernierResultat.trouves[+li.dataset.k]);
    });
    releve.querySelector('#rListe').addEventListener('keydown', function (e) {
      var li = e.target.closest('li[data-k]');
      if (li && e.key === 'Enter') allerAuResultat(dernierResultat.trouves[+li.dataset.k]);
    });
    majRecherche(true);
  }

  var resultatsMontres = 0;
  function majRecherche(tout) {
    var res = dernierResultat;
    if (vue !== 'recherche' || !res) {
      if (!res) return;
      var ong = $('#onglets').querySelector('[data-vue="recherche"]');
      if (ong) ong.textContent = 'Recherche (' + nombre(res.trouves.length) + ')'; else dessinerOnglets(courant ? ongletsPour(courant) : []);
      return;
    }
    var barre = $('#rBarre'), liste = $('#rListe');
    if (!barre) return;
    var pct = res.total ? Math.round(100 * res.lus / res.total) : 100;
    barre.innerHTML = '<span>« ' + echapper(res.q) + ' » : ' + nombre(res.trouves.length) + ' ligne' + (res.trouves.length > 1 ? 's' : '') + ' dans ' + nombre(res.textes) + ' texte' + (res.textes > 1 ? 's' : '') + '</span>' +
      (res.fini ? '<span class="note">' + (res.total ? 'Recherche finie.' : 'Aucun texte reconnu pour l\'instant : ouvre des GARC de texte, ou coche « GARC fermés aussi ».') + '</span>'
        : '<span class="progression" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><span style="width:' + pct + '%"></span></span><span class="note">' + nombre(res.lus) + ' sur ' + nombre(res.total) + '</span><button type="button" class="ticket" id="rArret">Arrêter</button>');
    var arret = barre.querySelector('#rArret');
    if (arret) arret.addEventListener('click', function () { rechercheJeton++; res.fini = true; majRecherche(); });
    if (tout) { liste.innerHTML = ''; resultatsMontres = 0; }
    var html = '', fin = Math.min(res.trouves.length, 1500);
    for (var k = resultatsMontres; k < fin; k++) {
      var r = res.trouves[k], ou = r.ou.n ? chemin(r.ou.n) : chemin(r.ou.boite) + ' › ' + r.ou.noms[r.ou.noms.length - 1];
      html += '<li tabindex="0" data-k="' + k + '"><div class="ou">' + echapper(ou) + ' <span class="pale">ligne ' + r.ligne + '</span></div><div class="extrait">' + surligner(r.texte.length > 260 ? r.texte.slice(0, 260) + '…' : r.texte, res.qn) + '</div></li>';
    }
    resultatsMontres = fin;
    if (html) liste.insertAdjacentHTML('beforeend', html);
    if (res.fini && res.trouves.length > 1500 && !liste.querySelector('.reste')) liste.insertAdjacentHTML('beforeend', '<li class="reste">Les ' + nombre(res.trouves.length - 1500) + ' suivantes ne sont pas montrées : précise la recherche.</li>');
    var o = $('#onglets').querySelector('[data-vue="recherche"]');
    if (o) o.textContent = 'Recherche (' + nombre(res.trouves.length) + ')';
  }

  function allerAuResultat(r) {
    var options = { vue: 'texte', ligne: r.ligne, surligne: dernierResultat.qn };
    if (r.ou.n) { revelerAncetres(r.ou.n); selectionnerAvec(r.ou.n, options); return; }
    revelerAncetres(r.ou.boite);
    ouvrirChemin(r.ou.boite, r.ou.noms).then(function (cible) { if (cible) selectionnerAvec(cible, options); });
  }
  function revelerAncetres(n) {
    var p = n.parent, change = false;
    while (p) { if (!p.ouvert) { p.ouvert = true; change = true; } p = p.parent; }
    if (change) aplatir();
  }

  $('#recherche').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('#q').value.trim();
    if (!q || !racine) return;
    chercher(q, $('#aussiFermes').checked);
  });

  // ================================================================ accueil

  function parler(t) { var r = $('#releve'); r.innerHTML = '<p class="parole">' + echapper(t) + '</p>'; }

  function accueil() {
    dessinerFiche();
    dessinerArbre();
    $('#onglets').innerHTML = '';
    var releve = $('#releve');
    releve.innerHTML = '<div class="accueil"><button type="button" class="cible" id="cible"><strong>Glisse ici le dossier romfs/</strong>' +
      '<span>ou clique pour le choisir. Un GARC seul ou quelques fichiers isolés vont aussi.</span></button></div>';
    releve.querySelector('#cible').addEventListener('click', choisirDossier);
  }

  // Pour les essais : charger une liste { chemin, octets } comme si on l'avait glissée.
  window.explorateur = {
    charger: function (liste) {
      charger(liste.map(function (e) { return { chemin: e.chemin, fichier: new File([e.octets], e.chemin.split('/').pop()) }; }));
    },
    selectionnerChemin: function (texte) {
      var trouve = null;
      (function parcours(n) { if (trouve) return; if (chemin(n) === texte) { trouve = n; return; } if (n.enfants) n.enfants.forEach(parcours); })(racine);
      if (trouve) { revelerAncetres(trouve); aplatir(); selectionnerAvec(trouve, {}); }
      return !!trouve;
    },
    basculerChemin: function (texte) {
      var trouve = null;
      (function parcours(n) { if (trouve) return; if (chemin(n) === texte) { trouve = n; return; } if (n.enfants) n.enfants.forEach(parcours); })(racine);
      return trouve ? basculer(trouve, true).then(function () { return true; }) : Promise.resolve(false);
    }
  };

  brancherChargement();
  brancherArbre();
  brancherTable();
  accueil();
})();
