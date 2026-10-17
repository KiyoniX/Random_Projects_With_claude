// Décompil 3DS : dessine la carte mère et remplit les feuilles à partir de window.ETAT (écrit par outils/verifier.py).
(function () {
  'use strict';

  var E = window.ETAT || null;
  var NS = 'http://www.w3.org/2000/svg';
  var C = {
    vernis: '#1b5e36', piste: '#154a2b', serigraphie: '#eef1ea', or: '#d6a73b', orOmbre: '#9c7420',
    etain: '#c3c9cd', plastique: '#3a3f45', boitier: '#15181c', tapis: '#2e4d63', papier: '#f6f5ef',
    encre: '#1e2226', encrePale: '#5a6168'
  };
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  // ---------- Petits outils ----------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function date(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? (+m[3] === 1 ? '1er' : +m[3]) + ' ' + MOIS[+m[2] - 1] + ' ' + m[1] : (iso || '?');
  }
  function virgule(n) { return n.toFixed(1).replace('.', ','); }
  // Le détail du compteur de fonctions, binaire par binaire (écrit par outils/couverture.py mesure).
  function parBinaire(f) {
    if (!f.binaires || !f.binaires.length) return '';
    var cols = ['trouvees', 'nommees', 'citees', 'recompilees'];
    return '<details><summary>par binaire</summary><table><tr><th>binaire</th><th>trouvées</th><th>nommées</th><th>citées</th><th>recompilées</th></tr>' +
      f.binaires.map(function (b) {
        return '<tr><td>' + esc(b.nom) + '</td>' + cols.map(function (k) { return '<td>' + b[k] + '</td>'; }).join('') + '</tr>';
      }).join('') + '</table></details>';
  }
  function mo(octets) { return (octets / 1e6).toFixed(1).replace('.', ',') + ' Mo'; }

  // Même calcul que verifier.py, fonction avancement : poids × part des tâches faites, sur la somme des poids.
  function avancement(etat) {
    var total = 0, fait = 0;
    etat.paliers.forEach(function (p) {
      total += p.poids;
      if (p.taches.length) fait += p.poids * faites(p) / p.taches.length;
    });
    return total ? Math.round(1000 * fait / total) / 10 : 0;
  }
  function faites(p) { return p.taches.filter(function (t) { return t.fait; }).length; }
  function etatPalier(p) {
    var f = faites(p);
    return f === 0 ? 'vide' : f === p.taches.length ? 'plein' : 'moitie';
  }
  function pctPalier(p) { return p.taches.length ? Math.round(100 * faites(p) / p.taches.length) : 0; }
  function enCours(etat) {
    for (var i = 0; i < etat.paliers.length; i++) if (etatPalier(etat.paliers[i]) !== 'plein') return etat.paliers[i];
    return null;
  }

  // Pastille de cuivre imprimée sur papier : pleine, à moitié, vide, ou barrée (invisible depuis le PC).
  function pastille(etat, taille, titre) {
    taille = taille || 16;
    var s = '<svg class="pastille" width="' + taille + '" height="' + taille + '" viewBox="0 0 16 16" aria-hidden="true">';
    if (titre) s = s.replace('aria-hidden="true"', 'role="img" aria-label="' + esc(titre) + '"');
    s += '<circle cx="8" cy="8" r="6.4" fill="' + (etat === 'plein' ? C.or : '#fff') + '" stroke="' + C.orOmbre + '" stroke-width="2"/>';
    if (etat === 'moitie') s += '<path d="M8 1.6A6.4 6.4 0 0 0 8 14.4Z" fill="' + C.or + '" stroke="' + C.orOmbre + '" stroke-width="1"/>';
    if (etat === 'barre') s += '<path d="M2.6 13.4 13.4 2.6" stroke="' + C.encre + '" stroke-width="2"/>';
    return s + '</svg>';
  }
  var MOT_PALIER = { plein: 'terminé', moitie: 'entamé', vide: 'pas commencé' };

  // ---------- La carte mère ----------

  function el(tag, attrs, parent, texte) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (texte != null) n.textContent = texte;
    if (parent) parent.appendChild(n);
    return n;
  }
  function lien(parent, href, label) {
    var a = el('a', { href: href, 'aria-label': label }, parent);
    el('title', {}, a, label);
    return a;
  }
  function txt(parent, x, y, taille, s, attrs) {
    var a = { x: x, y: y, 'font-size': taille };
    for (var k in attrs || {}) a[k] = attrs[k];
    return el('text', a, parent, s);
  }

  // Une puce : boîtier noir, broches en étain sur les côtés demandés, point de repère de la broche 1.
  function puce(g, x, y, w, h, cotes) {
    var L = 9, e = 5;
    function rangee(n, debut, longueur, place) {
      var pas = (longueur - 16) / Math.max(1, n - 1);
      for (var i = 0; i < n; i++) place(debut + 8 + i * pas - e / 2);
    }
    if (cotes.haut) rangee(cotes.haut, x, w, function (p) { el('rect', { x: p, y: y - L, width: e, height: L, fill: C.etain }, g); });
    if (cotes.bas) rangee(cotes.bas, x, w, function (p) { el('rect', { x: p, y: y + h, width: e, height: L, fill: C.etain }, g); });
    if (cotes.gauche) rangee(cotes.gauche, y, h, function (p) { el('rect', { x: x - L, y: p, width: L, height: e, fill: C.etain }, g); });
    if (cotes.droite) rangee(cotes.droite, y, h, function (p) { el('rect', { x: x + w, y: p, width: L, height: e, fill: C.etain }, g); });
    el('rect', { x: x, y: y, width: w, height: h, fill: C.boitier }, g);
    el('circle', { cx: x + 11, cy: y + 11, r: 4.5, fill: C.plastique }, g);
  }
  function contour(g, x, y, w, h) { el('rect', { class: 'contour', x: x - 6, y: y - 6, width: w + 12, height: h + 12 }, g); }

  // Composant monté en surface : corps et deux terminaisons étamées.
  function cms(svg, x, y, vertical, nom) {
    var g = el('g', {}, svg);
    if (vertical) {
      el('rect', { x: x, y: y, width: 8, height: 4, fill: C.etain }, g);
      el('rect', { x: x, y: y + 4, width: 8, height: 9, fill: C.boitier }, g);
      el('rect', { x: x, y: y + 13, width: 8, height: 4, fill: C.etain }, g);
      if (nom) txt(g, x + 12, y + 12, 9, nom);
    } else {
      el('rect', { x: x, y: y, width: 4, height: 8, fill: C.etain }, g);
      el('rect', { x: x + 4, y: y, width: 9, height: 8, fill: C.boitier }, g);
      el('rect', { x: x + 13, y: y, width: 4, height: 8, fill: C.etain }, g);
      if (nom) txt(g, x, y - 4, 9, nom);
    }
  }
  function via(svg, x, y) {
    el('circle', { cx: x, cy: y, r: 3.6, fill: C.etain }, svg);
    el('circle', { cx: x, cy: y, r: 1.5, fill: C.piste }, svg);
  }
  function piste(svg, points, dore, largeur) {
    return el('polyline', {
      points: points.map(function (p) { return p.join(','); }).join(' '),
      fill: 'none', stroke: dore ? C.or : C.piste, 'stroke-width': largeur || 4,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round'
    }, svg);
  }
  // Un point de test : rond cerclé d'or, plein si le palier est fait, demi-disque s'il est entamé.
  function padTP(g, cx, cy, etat, r) {
    r = r || 10;
    el('circle', { cx: cx, cy: cy, r: r, fill: C.piste, stroke: C.or, 'stroke-width': 3 }, g);
    if (etat === 'plein') el('circle', { cx: cx, cy: cy, r: r - 3, fill: C.or }, g);
    if (etat === 'moitie') el('path', { d: 'M' + cx + ' ' + (cy - r + 3) + 'A' + (r - 3) + ' ' + (r - 3) + ' 0 0 0 ' + cx + ' ' + (cy + r - 3) + 'Z', fill: C.or }, g);
  }

  function dessinerCarte() {
    var svg = document.getElementById('carte-mere');
    var paliers = E ? E.paliers : [];
    function P(n) { return paliers[n - 1] || null; }
    function fait(n) { return P(n) ? etatPalier(P(n)) === 'plein' : false; }

    // Le circuit imprimé, coins cassés, et ses quatre trous de fixation.
    el('path', { d: 'M22 8H978L992 22V418L978 432H22L8 418V22Z', fill: C.vernis, stroke: C.piste, 'stroke-width': 2 }, svg);
    [[34, 34], [966, 34], [34, 406], [966, 406]].forEach(function (t) {
      el('circle', { cx: t[0], cy: t[1], r: 13, fill: C.or }, svg);
      el('circle', { cx: t[0], cy: t[1], r: 7.5, fill: C.tapis }, svg);
    });

    var dump = E && E.dump && E.dump.present;

    // Bus et pistes décoratives, dessinés sous les composants.
    [334, 348, 362, 376, 390].forEach(function (x) { piste(svg, [[x, 122], [x, 162]], dump, 3); });          // cartouche → CPU : dorées quand le dump est là
    [196, 208, 220, 232].forEach(function (y) { piste(svg, [[459, y], [530, y]], false, 3); });               // CPU → FCRAM
    [300, 312, 324].forEach(function (y) { piste(svg, [[459, y], [521, y]], false, 3); });                     // CPU → NAND
    piste(svg, [[836, 231], [836, 272], [459, 272]], false, 3);                                                // UART → CPU
    piste(svg, [[860, 231], [860, 280], [500, 280], [500, 286], [459, 286]], false, 3);
    piste(svg, [[870, 146], [870, 172], [935, 172], [935, 300]], false, 3);                                    // microSD → (vers l'alimentation)
    piste(svg, [[281, 196], [240, 196], [240, 140], [190, 140]], false, 3);
    via(svg, 190, 140); via(svg, 500, 286); via(svg, 935, 300);
    piste(svg, [[281, 316], [250, 316], [250, 350]], false, 3); via(svg, 250, 350);

    // Pistes des points de test, dorées quand le palier est terminé.
    var TP = [
      { n: 1, x: 110, y: 172, trace: [[110, 122], [110, 162]], lx: 126, ly: 177 },
      { n: 2, x: 740, y: 100, trace: [[795, 100], [750, 100]], lx: 740, ly: 128, centre: true },
      { n: 3, x: 214, y: 250, trace: [[281, 250], [224, 250]], lx: 214, ly: 278, centre: true },
      { n: 4, x: 640, y: 136, trace: [[640, 171], [640, 146]], lx: 656, ly: 141 },
      { n: 5, x: 760, y: 203, trace: [[812, 203], [770, 203]], lx: 760, ly: 231, centre: true },
      { n: 6, x: 370, y: 392, trace: [[370, 339], [370, 382]], lx: 388, ly: 397 },
      { n: 7, x: 590, y: 398, trace: [[590, 360], [590, 388]], lx: 608, ly: 403 }
    ];
    TP.forEach(function (t) { piste(svg, t.trace, fait(t.n)); });

    // J1 : le connecteur de cartouche.
    var g = lien(svg, '#jeu', 'J1, le connecteur de cartouche : Pokémon X, ' + (E ? (dump ? 'dump présent' : 'dump absent') : 'état inconnu') + '. Ouvre la feuille « Le jeu ».');
    contour(g, 70, 34, 360, 90);
    el('rect', { x: 70, y: 34, width: 360, height: 78, fill: C.plastique }, g);
    el('rect', { x: 82, y: 42, width: 336, height: 10, fill: C.boitier }, g);
    for (var i = 0; i < 33; i++) el('rect', { x: 86 + i * 10, y: 112, width: 6, height: 12, fill: C.or }, g);
    txt(g, 88, 80, 22, 'Pokémon X');
    var etatDump = !E ? 'dump ?' : !dump ? 'dump absent' : E.dump.dechiffre === false ? 'dump chiffré' : 'dump présent';
    txt(g, 88, 102, 13, etatDump);
    txt(g, 444, 56, 15, 'J1', { class: 'vers' });
    txt(g, 444, 74, 11, 'CARTOUCHE', { class: 'vers' });

    // U1 : le processeur.
    g = lien(svg, '#carte', 'U1, le processeur CTR : ' + (E ? E.fonctions.identifiees + ' fonctions identifiées' : '') + '. Ouvre la carte du système.');
    contour(g, 281, 161, 178, 178);
    puce(g, 290, 170, 160, 160, { haut: 12, bas: 12, gauche: 12, droite: 12 });
    txt(g, 370, 222, 34, 'CTR', { 'text-anchor': 'middle', fill: C.etain, style: 'fill:' + C.etain });
    txt(g, 370, 244, 11, 'ARM11 + ARM9', { 'text-anchor': 'middle', style: 'fill:' + C.etain });
    txt(g, 370, 282, 12, 'fonctions', { 'text-anchor': 'middle', style: 'fill:' + C.etain });
    var f = E ? E.fonctions : null;
    txt(g, 370, 310, 22, f ? f.identifiees + ' / ' + (f.total == null ? '?' : f.total) : '? / ?', { 'text-anchor': 'middle', style: 'fill:' + C.etain });
    txt(g, 276, 176, 15, 'U1', { 'text-anchor': 'end', class: 'vers' });

    // U2 : la FCRAM, où vivent les données du jeu.
    var formats = P(4) ? faites(P(4)) : 0;
    g = lien(svg, '#pokemon', 'U2, la FCRAM : ' + formats + ' formats lus. Ouvre « Pokémon X, ce qu\'on sait ».');
    contour(g, 530, 171, 170, 93);
    puce(g, 530, 180, 170, 75, { haut: 14, bas: 14 });
    txt(g, 615, 211, 14, 'FCRAM 256 Mo', { 'text-anchor': 'middle', style: 'fill:' + C.etain });
    txt(g, 615, 238, 13, 'formats lus ' + (E ? formats : '?'), { 'text-anchor': 'middle', style: 'fill:' + C.etain });
    txt(g, 708, 196, 15, 'U2', { class: 'vers' });

    // U3 : la NAND, le système et ses outils.
    var pc = E ? E.outils.filter(function (o) { return o.lieu === 'pc'; }) : [];
    var pcOk = pc.filter(function (o) { return o.present; }).length;
    g = lien(svg, '#outils', 'U3, la NAND : ' + pcOk + ' outils sur ' + pc.length + ' présents sur le PC. Ouvre la feuille « Outils ».');
    contour(g, 521, 290, 138, 70);
    puce(g, 530, 290, 120, 70, { gauche: 6, droite: 6 });
    txt(g, 590, 318, 16, 'NAND', { 'text-anchor': 'middle', style: 'fill:' + C.etain });
    txt(g, 590, 344, 13, 'outils ' + (E ? pcOk + ' / ' + pc.length : '?'), { 'text-anchor': 'middle', style: 'fill:' + C.etain });
    txt(g, 664, 304, 15, 'U3', { class: 'vers' });

    // J2 : le lecteur microSD, en métal.
    g = lien(svg, '#exercices', 'J2, le lecteur microSD : les trois exercices à vérité connue.');
    contour(g, 795, 40, 150, 106);
    el('rect', { x: 795, y: 40, width: 150, height: 106, fill: C.etain }, g);
    el('rect', { x: 805, y: 50, width: 130, height: 4, fill: C.plastique, opacity: .5 }, g);
    el('rect', { x: 803, y: 132, width: 134, height: 8, fill: C.plastique }, g);
    [[795, 64], [795, 112], [941, 64], [941, 112]].forEach(function (p) { el('rect', { x: p[0] - 4, y: p[1], width: 8, height: 12, fill: C.etain, stroke: C.plastique, 'stroke-width': 1 }, g); });
    txt(g, 870, 86, 17, 'microSD', { 'text-anchor': 'middle', style: 'fill:' + C.encre });
    txt(g, 870, 112, 12, '3 exercices', { 'text-anchor': 'middle', style: 'fill:' + C.encre });
    txt(g, 795, 166, 13, 'J2 microSD', { class: 'vers' });

    // J3 : l'en-tête UART, 2 × 5 broches dorées.
    var nbJ = E ? E.journal.length : 0;
    g = lien(svg, '#journal', 'J3, le port série UART : le journal, ' + nbJ + ' entrées.');
    contour(g, 802, 190, 168, 46);
    el('rect', { x: 802, y: 190, width: 122, height: 46, fill: 'none', stroke: C.serigraphie, 'stroke-width': 1.5 }, g);
    for (var r = 0; r < 2; r++) for (var k = 0; k < 5; k++) {
      var cx = 819 + k * 22, cy = 203 + r * 22;
      if (r === 0 && k === 0) el('rect', { x: cx - 7, y: cy - 7, width: 14, height: 14, fill: C.or }, g);
      else el('circle', { cx: cx, cy: cy, r: 7, fill: C.or }, g);
      el('circle', { cx: cx, cy: cy, r: 2.6, fill: C.boitier }, g);
    }
    txt(g, 932, 208, 13, 'J3', { class: 'vers' });
    txt(g, 932, 226, 11, 'UART', { class: 'vers' });
    txt(g, 876, 262, 12, 'journal', { class: 'vers' });
    txt(g, 876, 278, 12, String(E ? nbJ : '?'), { class: 'vers' });

    // Quelques composants passifs, un quartz.
    cms(svg, 474, 146, false, 'C12'); cms(svg, 474, 340, false, 'C14'); cms(svg, 250, 300, true, 'R3');
    cms(svg, 712, 248, true, 'C21'); cms(svg, 486, 380, false, 'R8'); cms(svg, 168, 210, true, 'C3');
    el('rect', { x: 182, y: 330, width: 40, height: 16, rx: 8, fill: C.etain }, svg);
    txt(svg, 182, 362, 9, 'Y1');

    // Les points de test, un par palier.
    TP.forEach(function (t) {
      var p = P(t.n), et = p ? etatPalier(p) : 'vide';
      var label = 'TP' + t.n + ', palier ' + t.n + (p ? ' : ' + p.nom + ', ' + MOT_PALIER[et] + ' (' + pctPalier(p) + ' %)' : '');
      var a = lien(svg, '#palier-' + t.n, label);
      el('circle', { class: 'contour', cx: t.x, cy: t.y, r: 15 }, a);
      padTP(a, t.x, t.y, et);
      txt(a, t.lx, t.ly, 12, 'TP' + t.n, t.centre ? { 'text-anchor': 'middle', class: 'vers' } : { class: 'vers' });
    });

    // Légende des points de test, en sérigraphie.
    var lg = el('g', {}, svg);
    [['vide', 'À FAIRE', 62], ['moitie', 'ENTAMÉ', 152], ['plein', 'FAIT', 236]].forEach(function (l) {
      padTP(lg, l[2] + 6, 392, l[0], 7);
      txt(lg, l[2] + 18, 396, 11, l[1]);
    });
    txt(lg, 56, 422, 10, 'CLIQUE UN COMPOSANT POUR OUVRIR SA FEUILLE');

    // Le cartouche de sérigraphie : titre, révision, avancement.
    var pct = E ? virgule(avancement(E)) + ' %' : '? %';
    g = lien(svg, '#route', 'Avancement global : ' + pct + '. Ouvre la feuille de route.');
    contour(g, 700, 304, 248, 120);
    el('rect', { x: 700, y: 304, width: 248, height: 120, fill: 'none', stroke: C.serigraphie, 'stroke-width': 1.5 }, g);
    txt(g, 712, 328, 22, 'DÉCOMPIL 3DS');
    var rev = E && E.ouverture ? E.ouverture.slice(0, 7) : '';
    txt(g, 712, 345, 11, 'REV A  NEW 3DS XL  ' + rev);
    txt(g, 712, 394, 56, pct, { class: 'vers' });
    txt(g, 712, 415, 11, 'AVANCEMENT');
  }

  // ---------- Fiche d'intervention ----------

  function remplirFiche() {
    if (!E) return;
    var pct = avancement(E), cours = enCours(E);
    var pads = E.paliers.map(function (p) {
      var et = etatPalier(p);
      return '<a href="#palier-' + p.id + '" title="TP' + p.id + ' : ' + esc(p.nom) + ', ' + MOT_PALIER[et] + '">' +
        pastille(et, 22, 'Palier ' + p.id + ', ' + MOT_PALIER[et]) + p.id + '</a>';
    }).join('');
    var d = E.dump || {}, dumpTxt;
    if (!d.present) dumpTxt = '<span class="bloque">aucun dans local/dump/</span>';
    else if (d.dechiffre === false) dumpTxt = esc(d.fichiers[0]) + ', <span class="bloque">encore chiffré</span>';
    else dumpTxt = '✓ ' + esc(d.fichiers[0]) + (d.dechiffre ? ', déchiffré' : '');
    var f = E.fonctions;
    var h = '<dl>' +
      '<dt>Appareil</dt><dd>' + esc(E.console) + '</dd>' +
      '<dt>Demande</dt><dd>' + esc(E.objectif) + '</dd>' +
      '<dt>Ouverte le</dt><dd class="dates"><span>' + date(E.ouverture) + '</span><span>mise à jour le ' + date(E.mise_a_jour) + '</span></dd>' +
      '<dt>Avancement</dt><dd class="avancement"><span class="gros">' + virgule(pct) + ' %</span><span class="pads">' + pads + '</span></dd>' +
      '<dt>Dump</dt><dd>' + dumpTxt + '</dd>' +
      '<dt>Fonctions</dt><dd>' + f.identifiees + ' identifiées sur ' + (f.total == null ? '?' : f.total) + ', ' + f.nommees + ' nommées, ' + f.reimplementees + ' réimplémentées' + parBinaire(f) + '</dd>' +
      '</dl>' +
      '<p class="pied">Pour remettre la fiche à jour, dans le dossier du projet : <code>python outils/verifier.py</code></p>';
    document.getElementById('fiche-corps').innerHTML = h;

    // La bande sous la carte : où l'on en est, et le prochain geste.
    document.getElementById('ici-corps').innerHTML =
      '<p class="ou">' + (cours
        ? pastille(etatPalier(cours), 20) + '<span>Palier en cours : <a href="#palier-' + cours.id + '"><span class="tp">TP' + cours.id + '</span> ' + esc(cours.nom) + '</a>, ' + (faites(cours) ? faites(cours) + ' tâche' + (faites(cours) > 1 ? 's faites' : ' faite') + ' sur ' + cours.taches.length : 'aucune des ' + cours.taches.length + ' tâches n\'est faite') + '.</span>'
        : pastille('plein', 20) + '<span>Les sept paliers sont terminés.</span>') + '</p>' +
      '<p class="geste">Prochaine action : ' + esc(E.prochaine_action) + '</p>';
  }

  // ---------- Le jeu : le relevé ----------

  function remplirReleve() {
    if (!E) return;
    var d = E.dump || {}, x = E.extrait || {}, l = [];
    function ligne(cle, val) { l.push((cle + '               ').slice(0, 14) + val); }
    function ko(s) { return '<span class="bloque">✗ ' + esc(s) + '</span>'; }
    function ok(s) { return '<span class="acquis">✓ ' + esc(s) + '</span>'; }
    if (!d.present) {
      ligne('local/dump/', ko('aucun fichier .cxi ni .3ds'));
    } else {
      ligne('Dump', ok(d.fichiers.join(', ')));
      if (d.erreur) ligne('Lecture', ko(d.erreur));
      if (d.titre) ligne('Titre', esc(d.titre) + (d.produit ? '   ' + esc(d.produit) : ''));
      if ('dechiffre' in d) ligne('Chiffrement', d.dechiffre ? ok('déchiffré, prêt à extraire') : ko('encore chiffré : dans GodMode9, « NCCH image options » puis « Decrypt file »'));
      if (d.exefs) ligne('Code (exefs)', mo(d.exefs));
      if (d.romfs) ligne('Fichiers', mo(d.romfs) + ' (romfs)');
    }
    ligne('Extraction', x.present ? ok('code.bin, ' + x.code_octets.toLocaleString('fr-FR') + ' octets') : ko('code.bin pas encore extrait'));
    ligne('Relevé du', date(E.mise_a_jour));
    document.getElementById('releve').innerHTML = l.join('\n');
  }

  // ---------- Feuille de route ----------

  function remplirRoute() {
    var ol = document.getElementById('paliers');
    if (!E) { ol.innerHTML = '<li class="absent-etat">Les paliers viennent de <code>etat.js</code> : lance <code>python outils/verifier.py</code>.</li>'; return; }
    var cours = enCours(E);
    ol.innerHTML = E.paliers.map(function (p) {
      var et = etatPalier(p), ici = cours && cours.id === p.id;
      return '<li class="palier' + (ici ? ' en-cours' : '') + '" id="palier-' + p.id + '">' +
        '<div class="repere">' + pastille(et, 28, MOT_PALIER[et]) +
        '<span class="tp">TP' + p.id + '</span><span class="pct">' + pctPalier(p) + ' %</span>' +
        '<span class="poids">poids ' + p.poids + '</span>' + (ici ? '<span class="ici">▶ tu es ici</span>' : '') + '</div>' +
        '<div><h3>' + p.id + '. ' + esc(p.nom) + '</h3><p class="but-palier">' + esc(p.but) + '</p></div>' +
        '<ul class="taches">' + p.taches.map(function (t) {
          return '<li' + (t.fait ? ' class="fait"' : '') + '><span class="etat-tache">' + (t.fait ? 'fait : ' : 'à faire : ') + '</span>' + esc(t.t) + '</li>';
        }).join('') + '</ul></li>';
    }).join('');
  }

  // ---------- Outils ----------

  function etatOutil(o) {
    if (o.present === null || o.present === undefined) return { forme: 'barre', mot: 'invisible au PC', titre: 'Le PC ne peut pas le vérifier : regarde sur la console.' };
    if (!o.present) return { forme: 'vide', mot: 'absent', bloque: true };
    return { forme: 'plein', mot: o.lieu === 'web' ? 'en ligne' : o.lieu === 'console' ? 'sur la console' : 'présent' };
  }

  function remplirOutils() {
    var tb = document.getElementById('outils-corps');
    if (!E) { tb.innerHTML = '<tr><td colspan="4" class="absent-etat">La liste vient de <code>etat.js</code> : lance <code>python outils/verifier.py</code>.</td></tr>'; return; }
    // REA, l'outil principal du parcours, vient en tête.
    var liste = E.outils.slice().sort(function (a, b) { return (b.id === 'rea') - (a.id === 'rea'); });
    tb.innerHTML = liste.map(function (o) {
      var s = etatOutil(o), principal = o.id === 'rea';
      var nom = o.lien ? '<a href="' + esc(o.lien) + '">' + esc(o.nom) + '</a>' : esc(o.nom);
      return '<tr' + (principal ? ' class="principal"' : '') + '><th scope="row">' + nom + (principal ? '<span class="principal-mot">l\'outil principal</span>' : '') + '</th>' +
        '<td>' + esc(o.role) + (o.note ? '<span class="note">' + esc(o.note) + '</span>' : '') +
        (principal && !/\bPE\b/.test(o.role) ? '<span class="note">Sous Windows, il n\'ouvre que des exécutables PE x86 : pour notre ARM, il faudra le faire tourner sous WSL (voir <code>outils/REA.md</code>).</span>' : '') + '</td>' +
        '<td>' + (/\s/.test(o.ou) ? esc(o.ou) : '<code>' + esc(o.ou) + '</code>') + '</td>' +
        '<td><span class="etat-outil"' + (s.titre ? ' title="' + esc(s.titre) + '"' : '') + '>' + pastille(s.forme, 16) +
        '<span' + (s.bloque ? ' class="bloque"' : '') + '>' + s.mot + '</span></span></td></tr>';
    }).join('');
    document.getElementById('legende-outils').innerHTML =
      '<span>' + pastille('plein') + 'présent</span><span>' + pastille('vide') + 'absent</span>' +
      '<span>' + pastille('barre') + 'invisible au PC : seule la console peut le dire</span>';
  }

  // ---------- Formats de Pokémon X ----------

  function remplirFormats() {
    var lignes = document.querySelectorAll('#formats tbody tr');
    Array.prototype.forEach.call(lignes, function (tr) {
      var td = tr.lastElementChild, et = tr.getAttribute('data-etat');
      td.innerHTML = pastille(et, 16, et === 'plein' ? 'écrit' : 'à écrire') + td.innerHTML;
    });
  }

  // ---------- Journal ----------

  function remplirJournal() {
    var ol = document.getElementById('journal-liste');
    if (!E) { ol.innerHTML = '<li class="absent-etat">Le journal vient de <code>etat.js</code> : lance <code>python outils/verifier.py</code>.</li>'; return; }
    // Le plus récent en haut ; à date égale, la dernière entrée écrite d'abord.
    var j = E.journal.map(function (e, i) { return { e: e, i: i }; });
    j.sort(function (a, b) { return a.e.date < b.e.date ? 1 : a.e.date > b.e.date ? -1 : b.i - a.i; });
    ol.innerHTML = j.map(function (x) {
      return '<li><time datetime="' + esc(x.e.date) + '">' + esc(x.e.date) + '</time><p>' + esc(x.e.texte) + '</p></li>';
    }).join('');
  }

  dessinerCarte();
  remplirFiche();
  remplirReleve();
  remplirRoute();
  remplirOutils();
  remplirFormats();
  remplirJournal();
})();
