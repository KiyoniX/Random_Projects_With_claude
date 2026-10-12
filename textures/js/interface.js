(function () {
  'use strict';

  var T = window.Textures;

  var CLE = 'textures.collection';
  var COLLECTION_MAX = 80;
  var NB_VARIANTES = 12;
  var ECHELLES = [2, 3, 4, 6, 8, 12, 16];
  var DELAI_ADRESSE = 250;       // millisecondes de calme avant d'écrire l'adresse
  var COTE_MAX = 8192;           // côté maximal d'une image exportée

  var $ = function (s) { return document.querySelector(s); };
  function echapper(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- État ----------
  // E : les réglages. tex : la texture préparée. images : les images déjà calculées de la boucle.
  var E, tex = null, images = [], iImage = 0, jeton = 0, lecture = true, temps = 0;
  var memoire = {};              // réglages propres à chaque matière, retrouvés quand on y revient
  var collection = [];
  var adresse = '', minuterieAdresse = null, minuterieMsg = null, signature = '';

  function matiere() { return T.parId[E.matiere]; }
  function graineAuHasard() { return Math.random().toString(36).slice(2, 8); }

  function message(texte) {
    $('#etatMsg').textContent = texte;
    clearTimeout(minuterieMsg);
    minuterieMsg = setTimeout(function () { $('#etatMsg').textContent = ''; }, 5000);
  }

  // ---------- Calcul ----------
  function calculer() {
    var t0 = performance.now();
    E = T.normaliser(E);
    tex = T.preparer(E);
    images = [T.image(tex, 0)];
    temps = performance.now() - t0;
    jeton++;
    if (iImage >= tex.nb) iImage = 0;
    if (tex.nb > 1) suite(jeton);
    dessiner();
    majEtat();
    noterAdresse();
  }

  // Les autres images de la boucle se calculent une à une, sans bloquer les curseurs.
  function suite(j) {
    setTimeout(function () {
      if (j !== jeton || images.length >= tex.nb) return;
      images.push(T.image(tex, images.length));
      if (images.length < tex.nb) suite(j);
    }, 0);
  }
  function toutes() {
    while (images.length < tex.nb) images.push(T.image(tex, images.length));
    return images;
  }

  // ---------- Aperçu ----------
  function peindre(canvas, indices, couleurs, n) {
    if (canvas.width !== n) canvas.width = canvas.height = n;
    var g = canvas.getContext('2d'), im = g.createImageData(n, n);
    new Uint32Array(im.data.buffer).set(T.pixels(indices, couleurs));
    g.putImageData(im, 0, 0);
  }

  function dessiner() {
    var n = tex.n, ct = $('#tuile'), cp = $('#pavage'), rep = Number($('#oRep').value), z = Number($('#oZoom').value);
    var cadre = $('#cadreTuile'), zt, cote, g, i, j;
    peindre(ct, images[Math.min(iImage, images.length - 1)], tex.couleurs, n);
    zt = Math.max(1, Math.floor((Math.min(cadre.clientWidth, cadre.clientHeight) - 22) / n));
    ct.style.width = ct.style.height = n * zt + 'px';
    cadre = $('#cadrePavage');
    if (!z) z = Math.max(1, Math.floor((Math.min(cadre.clientWidth, cadre.clientHeight) - 22) / (n * rep)));
    cote = n * rep * z;
    if (cp.width !== cote) cp.width = cp.height = cote;
    g = cp.getContext('2d');
    g.imageSmoothingEnabled = false;
    for (j = 0; j < rep; j++) for (i = 0; i < rep; i++) g.drawImage(ct, i * n * z, j * n * z, n * z, n * z);
    if ($('#oBords').checked) {
      g.fillStyle = '#ff3df2';
      for (i = 1; i < rep; i++) { g.fillRect(i * n * z, 0, 1, cote); g.fillRect(0, i * n * z, cote, 1); }
    }
    $('#oImage').textContent = tex.nb > 1 ? (Math.min(iImage, images.length - 1) + 1) + ' / ' + tex.nb : '';
  }

  function tic() {
    var cadence = Math.max(1, Math.min(30, Number($('#oCadence').value) || 8));
    if (lecture && tex && tex.nb > 1 && images.length === tex.nb && $('#modal').hidden) {
      iImage = (iImage + 1) % tex.nb;
      dessiner();
    }
    setTimeout(tic, 1000 / cadence);
  }

  // ---------- Adresse ----------
  function noterAdresse() {
    clearTimeout(minuterieAdresse);
    minuterieAdresse = setTimeout(function () {
      adresse = '#' + T.versTexte(E);
      try { history.replaceState(null, '', adresse); } catch (e) { location.replace(adresse); }   // Chrome refuse replaceState en file://
    }, DELAI_ADRESSE);
  }

  function charger(texte) {
    E = T.depuisTexte(texte);
    iImage = 0;
    majInterface();
    calculer();
  }

  // ---------- Panneaux ----------
  function construireMatieres() {
    var h = '';
    T.matieres.forEach(function (m) {
      h += '<button type="button" class="matiere" data-id="' + m.id + '"><canvas width="32" height="32"></canvas><span>' + echapper(m.nom) + '</span>' + (m.anime ? '<i title="Matière animée">▶</i>' : '') + '</button>';
    });
    $('#matieres').innerHTML = h;
    T.matieres.forEach(function (m) {
      var r = T.defauts(m.id), res;
      r.images = 1;
      res = T.generer(r);
      peindre($('#matieres [data-id="' + m.id + '"] canvas'), res.images[0], res.couleurs, 32);
    });
  }

  function construireReglages() {
    var h = '';
    matiere().reglages.forEach(function (r) {
      if (r.options) {
        h += '<label class="reglage liste"><span>' + echapper(r.nom) + '</span><select data-id="' + r.id + '">' + r.options.map(function (o) {
          return '<option value="' + o[0] + '"' + (E.p[r.id] === o[0] ? ' selected' : '') + '>' + echapper(o[1]) + '</option>';
        }).join('') + '</select></label>';
      } else {
        h += '<label class="reglage" title="' + echapper(r.nom) + '"><span>' + echapper(r.nom) + '</span><input type="range" data-id="' + r.id + '" min="' + r.min + '" max="' + r.max + '" step="0.01" value="' + E.p[r.id] + '"><output>' + Math.round(E.p[r.id] * 100) + '</output></label>';
      }
    });
    $('#reglages').innerHTML = h;
  }

  // Les teintes de la matière, rampe par rampe. Celles que la limite de couleurs a fondues dans une voisine sont estompées.
  function construireTeintes() {
    var libre = E.palette === 'matiere', t = libre ? T.teintes(E) : tex.pleine.map(T.hexDepuisRgb), k = 0, h = '';
    matiere().rampes.forEach(function (ra) {
      h += '<div class="rampe"><span>' + echapper(ra.nom) + '</span><div>';
      ra.hex.forEach(function () {
        var fondue = T.hexDepuisRgb(tex.couleurs[tex.table[k]]) !== t[k] ? ' fondue' : '';
        h += libre ? '<button type="button" class="nuance' + fondue + '" data-k="' + k + '" style="--c:#' + t[k] + '" title="#' + t[k] + ' — cliquer pour changer cette teinte"></button>'
          : '<i class="nuance' + fondue + '" style="--c:#' + t[k] + '" title="#' + t[k] + '"></i>';
        k++;
      });
      h += '</div></div>';
    });
    $('#teintes').innerHTML = h;
    $('#notePalette').textContent = libre ? 'Clique une teinte pour la changer.' : 'Teintes remplacées par la palette.';
    $('#bTeintes').disabled = !E.teintes;
  }

  function majEtat() {
    var total = T.nbTeintes(matiere()), sig = E.matiere + '|' + E.palette + '|' + tex.pleine.join() + '|' + tex.table.join();
    if (sig !== signature) { signature = sig; construireTeintes(); }
    $('#couleursVal').textContent = E.couleurs ? E.couleurs : 'toutes';
    $('#contrasteVal').textContent = Math.round(E.contraste * 100) + ' %';
    $('#etatInfo').textContent = tex.n + ' × ' + tex.n + ' px · ' + tex.couleurs.length + ' couleur' + (tex.couleurs.length > 1 ? 's' : '') + ' (sur ' + total + ' teintes possibles)' +
      (tex.nb > 1 ? ' · boucle de ' + tex.nb + ' images' : '');
    $('#etatTemps').textContent = 'Image calculée en ' + (temps < 10 ? temps.toFixed(1) : Math.round(temps)) + ' ms';
  }

  // Met tous les champs d'accord avec E (après un changement de matière ou un chargement).
  function majInterface() {
    var m = matiere(), total = T.nbTeintes(m);
    document.querySelectorAll('.matiere').forEach(function (b) { b.classList.toggle('actif', b.dataset.id === m.id); });
    document.querySelectorAll('#tailles .btn').forEach(function (b) { b.classList.toggle('actif', Number(b.dataset.t) === E.taille); });
    $('#nomMatiere').textContent = m.nom;
    $('#titreReglages').textContent = m.nom;
    $('#graine').value = E.graine;
    $('#couleurs').max = total;
    $('#couleurs').value = E.couleurs || total;
    $('#contraste').value = E.contraste;
    $('#trame').value = E.trame;
    $('#palette').value = E.palette;
    $('#oImages').value = E.images;
    $('#animation').classList.toggle('inerte', !m.anime);
    $('#bPlanche').disabled = !m.anime || E.images < 2;
    signature = '';
    construireReglages();
  }

  function changerMatiere(id) {
    if (id === E.matiere) return;
    memoire[E.matiere] = { p: E.p, teintes: E.teintes, couleurs: E.couleurs };
    var d = T.defauts(id), m = memoire[id];
    E.matiere = id;
    E.p = m ? m.p : d.p;
    E.teintes = m ? m.teintes : null;
    E.couleurs = m ? m.couleurs : 0;
    iImage = 0;
    majInterface();
    calculer();
  }

  // ---------- Variantes ----------
  function variantes() {
    var n = E.taille, rep = n >= 128 ? 1 : 2, z = Math.max(1, Math.floor(128 / (n * rep))), h = '', graines = [], k;
    for (k = 0; k < NB_VARIANTES; k++) graines.push(graineAuHasard());
    graines.forEach(function (g) { h += '<button type="button" class="variante" data-g="' + g + '"><canvas></canvas>' + g + '</button>'; });
    $('#modal').innerHTML = '<div class="fen"><h2>Variantes — ' + echapper(matiere().nom) + '</h2>' +
      '<p class="note">Mêmes réglages, douze graines tirées au hasard. Clique celle que tu veux garder.</p>' +
      '<div class="variantes">' + h + '</div>' +
      '<div class="pied"><button type="button" class="btn" data-autres>Autres variantes</button><button type="button" class="btn fort" data-fermer>Fermer</button></div></div>';
    $('#modal').hidden = false;
    graines.forEach(function (g) {
      var r = T.normaliser(E), t, petit = document.createElement('canvas'), c = $('#modal [data-g="' + g + '"] canvas'), ctx, i, j;
      r.graine = g;
      t = T.preparer(r);
      peindre(petit, T.image(t, 0), t.couleurs, n);
      c.width = c.height = n * rep * z;
      ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      for (j = 0; j < rep; j++) for (i = 0; i < rep; i++) ctx.drawImage(petit, i * n * z, j * n * z, n * z, n * z);
    });
  }
  function fermer() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }

  // ---------- Export ----------
  function nomFichier(suffixe, ext) {
    return 'texture-' + E.matiere + '-' + (E.graine.replace(/[^\w-]+/g, '_') || 'graine') + (suffixe ? '-' + suffixe : '') + '.' + ext;
  }

  function telecharger(blob, nom) {
    var a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = nom;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
    message('Fichier « ' + nom + ' » téléchargé.');
  }

  // pix : pixels 0xAABBGGRR. L'agrandissement se fait au plus proche voisin.
  function telechargerPng(pix, w, h, k, nom) {
    var c = document.createElement('canvas'), g, im, grand;
    if (w * k > COTE_MAX || h * k > COTE_MAX) { message('Image trop grande : réduis l\'agrandissement.'); return; }
    c.width = w; c.height = h;
    g = c.getContext('2d');
    im = g.createImageData(w, h);
    new Uint32Array(im.data.buffer).set(pix);
    g.putImageData(im, 0, 0);
    if (k > 1) {
      grand = document.createElement('canvas');
      grand.width = w * k; grand.height = h * k;
      g = grand.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(c, 0, 0, w * k, h * k);
      c = grand;
    }
    c.toBlob(function (b) {
      if (b) telecharger(b, nom); else message('Export impossible : le navigateur n\'a pas pu fabriquer l\'image.');
    }, 'image/png');
  }

  // Colle des tuiles dans une grande image. cases : [{ pix, n, x, y }].
  function assembler(w, h, cases) {
    var o = new Uint32Array(w * h);
    cases.forEach(function (c) {
      for (var y = 0; y < c.n; y++) o.set(c.pix.subarray(y * c.n, (y + 1) * c.n), (c.y + y) * w + c.x);
    });
    return o;
  }

  function exporter(quoi) {
    var n = tex.n, k = Number($('#echelle').value), rep = Number($('#oRep').value), pix, cases = [], i, j;
    if (quoi === 'atelier') {
      toutes();
      telecharger(new Blob([JSON.stringify(T.versAtelier({ n: n, images: images, couleurs: tex.couleurs, r: E }, Math.round(1000 / (Number($('#oCadence').value) || 8))))], { type: 'application/json' }), nomFichier('', 'json'));
      return;
    }
    if (quoi === 'planche') {
      toutes().forEach(function (im, q) { cases.push({ pix: T.pixels(im, tex.couleurs), n: n, x: q * n, y: 0 }); });
      telechargerPng(assembler(n * tex.nb, n, cases), n * tex.nb, n, 1, nomFichier('planche-' + tex.nb + 'x' + n, 'png'));
      return;
    }
    pix = T.pixels(images[Math.min(iImage, images.length - 1)], tex.couleurs);
    if (quoi === 'pavage') {
      for (j = 0; j < rep; j++) for (i = 0; i < rep; i++) cases.push({ pix: pix, n: n, x: i * n, y: j * n });
      telechargerPng(assembler(n * rep, n * rep, cases), n * rep, n * rep, k, nomFichier('pavage-' + rep + 'x' + rep, 'png'));
    } else if (quoi === 'tuile1') telechargerPng(pix, n, n, 1, nomFichier(n + 'px', 'png'));
    else telechargerPng(pix, n, n, k, nomFichier(n + 'px-x' + k, 'png'));
  }

  // ---------- Collection ----------
  function lireCollection() {
    try {
      var t = JSON.parse(localStorage.getItem(CLE) || '[]');
      collection = Array.isArray(t) ? t.filter(function (f) { return f && typeof f.t === 'string' && typeof f.nom === 'string'; }).slice(0, COLLECTION_MAX) : [];
    } catch (e) { collection = []; }
  }
  function ecrireCollection() {
    try { localStorage.setItem(CLE, JSON.stringify(collection)); }
    catch (e) { message('La collection n\'a pas pu être enregistrée (stockage plein ou interdit) : elle sera perdue à la fermeture.'); }
  }

  function afficherCollection() {
    var zone = $('#collection');
    $('#collCompte').textContent = collection.length ? collection.length + ' texture' + (collection.length > 1 ? 's' : '') : '';
    $('#bAtlas').disabled = $('#bVider').disabled = !collection.length;
    if (!collection.length) { zone.innerHTML = '<span class="vide">Rien pour l\'instant : « ★ Garder » met la texture affichée de côté, avec sa graine et ses réglages.</span>'; return; }
    zone.innerHTML = collection.map(function (f, k) {
      return '<div class="image" role="button" tabindex="0" data-k="' + k + '" title="' + echapper(f.nom) + ' — cliquer pour la reprendre"><canvas></canvas><span>' + echapper(f.nom) + '</span><button type="button" class="oter" data-oter="' + k + '" title="Retirer de la collection">✕</button></div>';
    }).join('');
    collection.forEach(function (f, k) {
      var r = T.depuisTexte(f.t), t = T.preparer(r), n = t.n, rep = n <= 32 ? 2 : 1, petit = document.createElement('canvas'), c = zone.querySelector('[data-k="' + k + '"] canvas'), g, i, j;
      peindre(petit, T.image(t, 0), t.couleurs, n);
      c.width = c.height = n * rep;
      g = c.getContext('2d');
      for (j = 0; j < rep; j++) for (i = 0; i < rep; i++) g.drawImage(petit, i * n, j * n);
    });
  }

  function garder() {
    var t = T.versTexte(E);
    if (collection.some(function (f) { return f.t === t; })) { message('Cette texture est déjà dans la collection.'); return; }
    if (collection.length >= COLLECTION_MAX) { message('La collection est pleine (' + COLLECTION_MAX + ' textures).'); return; }
    collection.push({ nom: matiere().nom + ' · ' + E.graine, t: t });
    ecrireCollection();
    afficherCollection();
    $('#collection').scrollLeft = 1e6;
    message('Texture gardée dans la collection.');
  }

  // Planche commune : rangement par étagères, les plus hautes d'abord. Une texture animée y occupe une ligne d'images.
  function exporterAtlas() {
    var entrees = collection.map(function (f) {
      var res = T.generer(T.depuisTexte(f.t));
      return { f: f, res: res, w: res.n * res.nb, h: res.n };
    });
    var ordre = entrees.slice().sort(function (a, b) { return b.h - a.h || b.w - a.w; }), aire = 0, L = 64, x = 0, y = 0, rang = 0, cases = [];
    entrees.forEach(function (e) { aire += e.w * e.h; });
    ordre.forEach(function (e) { while (L < e.w) L *= 2; });
    while (L * L < aire) L *= 2;
    ordre.forEach(function (e) {
      if (x + e.w > L) { x = 0; y += rang; rang = 0; }
      e.x = x; e.y = y; x += e.w; rang = Math.max(rang, e.h);
      e.res.images.forEach(function (im, q) { cases.push({ pix: T.pixels(im, e.res.couleurs), n: e.res.n, x: e.x + q * e.res.n, y: e.y }); });
    });
    y += rang;
    if (L > COTE_MAX || y > COTE_MAX) { message('Atlas trop grand : retire quelques textures.'); return; }
    telechargerPng(assembler(L, y, cases), L, y, 1, 'textures-atlas.png');
    setTimeout(function () {
      telecharger(new Blob([JSON.stringify({
        format: 'textures-atlas', version: 1, image: 'textures-atlas.png', largeur: L, hauteur: y,
        textures: entrees.map(function (e) {
          return { nom: e.f.nom, matiere: e.res.r.matiere, graine: e.res.r.graine, x: e.x, y: e.y, taille: e.res.n, images: e.res.nb, reglages: e.f.t };
        })
      }, null, 2)], { type: 'application/json' }), 'textures-atlas.json');
    }, 400);
  }

  // ---------- Événements ----------
  function brancher() {
    $('#matieres').addEventListener('click', function (e) {
      var b = e.target.closest('.matiere');
      if (b) changerMatiere(b.dataset.id);
    });
    $('#tailles').addEventListener('click', function (e) {
      var b = e.target.closest('[data-t]');
      if (!b) return;
      E.taille = Number(b.dataset.t);
      majInterface();
      calculer();
    });
    $('#graine').addEventListener('input', function () { E.graine = this.value; calculer(); });
    $('#graine').addEventListener('change', function () { this.value = E.graine; });
    $('#bHasard').addEventListener('click', function () { E.graine = graineAuHasard(); $('#graine').value = E.graine; calculer(); });
    $('#bVariantes').addEventListener('click', variantes);
    $('#bGarder').addEventListener('click', garder);

    function reglage(e) {
      var el = e.target, id = el.dataset.id;
      if (!id) return;
      E.p[id] = el.tagName === 'SELECT' ? el.value : Number(el.value);
      if (el.nextElementSibling) el.nextElementSibling.textContent = Math.round(Number(el.value) * 100);
      calculer();
    }
    $('#reglages').addEventListener('input', reglage);
    $('#reglages').addEventListener('change', function (e) { if (e.target.tagName === 'SELECT') reglage(e); });
    $('#bDefauts').addEventListener('click', function () { E.p = T.defauts(E.matiere).p; construireReglages(); calculer(); });

    $('#couleurs').addEventListener('input', function () { E.couleurs = Number(this.value); calculer(); });
    $('#contraste').addEventListener('input', function () { E.contraste = Number(this.value); calculer(); });
    $('#trame').addEventListener('change', function () { E.trame = Number(this.value); calculer(); });
    $('#palette').addEventListener('change', function () { E.palette = this.value; calculer(); });
    $('#teintes').addEventListener('click', function (e) {
      var b = e.target.closest('button.nuance'), p = $('#pipette'), r;
      if (!b) return;
      r = b.getBoundingClientRect();
      p.style.left = r.left + 'px'; p.style.top = r.bottom + 'px'; p.style.right = 'auto';
      p.dataset.k = b.dataset.k;
      p.value = '#' + T.teintes(E)[Number(b.dataset.k)];
      p.click();
    });
    $('#pipette').addEventListener('input', function () {
      var t = T.teintes(E);
      t[Number(this.dataset.k)] = this.value.slice(1).toLowerCase();
      E.teintes = t;
      calculer();
    });
    $('#bTeintes').addEventListener('click', function () { E.teintes = null; calculer(); });

    $('#oRep').addEventListener('change', dessiner);
    $('#oZoom').addEventListener('change', dessiner);
    $('#oBords').addEventListener('change', dessiner);
    $('#oImages').addEventListener('change', function () { E.images = Number(this.value); iImage = 0; majInterface(); calculer(); });
    $('#bLire').addEventListener('click', basculerLecture);
    document.querySelector('.cote').addEventListener('click', function (e) {
      var b = e.target.closest('[data-export]');
      if (b) exporter(b.dataset.export);
    });

    $('#collection').addEventListener('click', function (e) {
      var o = e.target.closest('[data-oter]'), b = e.target.closest('.image');
      if (o) { collection.splice(Number(o.dataset.oter), 1); ecrireCollection(); afficherCollection(); }
      else if (b) { memoire = {}; charger(collection[Number(b.dataset.k)].t); message('« ' + collection[Number(b.dataset.k)].nom + ' » reprise.'); }
    });
    $('#collection').addEventListener('keydown', function (e) {
      var b = e.target.closest('.image');
      if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); b.click(); }
    });
    $('#bAtlas').addEventListener('click', exporterAtlas);
    $('#bVider').addEventListener('click', function () {
      if (!collection.length || !window.confirm('Retirer les ' + collection.length + ' textures de la collection ?')) return;
      collection = []; ecrireCollection(); afficherCollection();
    });

    $('#modal').addEventListener('click', function (e) {
      var v = e.target.closest('[data-g]');
      if (v) { E.graine = v.dataset.g; $('#graine').value = E.graine; fermer(); calculer(); }
      else if (e.target.closest('[data-autres]')) variantes();
      else if (e.target === this || e.target.closest('[data-fermer]')) fermer();
    });

    window.addEventListener('resize', function () { if (tex) dessiner(); });
    window.addEventListener('hashchange', function () {
      if (location.hash && location.hash !== adresse) { memoire = {}; charger(location.hash); }
    });
    document.addEventListener('keydown', function (e) {
      var cible = e.target.tagName, texte = cible === 'SELECT' || (cible === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox');
      if (e.key === 'Escape' && !$('#modal').hidden) { fermer(); return; }
      if (texte || e.ctrlKey || e.metaKey || e.altKey || !$('#modal').hidden) return;
      if (e.key === 'r' || e.key === 'R') $('#bHasard').click();
      else if (e.key === 'v' || e.key === 'V') variantes();
      else if (e.key === 'g' || e.key === 'G') garder();
      else if (e.key === ' ' && cible !== 'BUTTON') { e.preventDefault(); basculerLecture(); }
    });
  }

  function basculerLecture() {
    lecture = !lecture;
    $('#bLire').textContent = lecture ? '❚❚ Arrêter' : '▶ Lire';
  }

  // ---------- Démarrage ----------
  function demarrer() {
    $('#tailles').innerHTML = '<span>Taille</span>' + T.TAILLES.map(function (t) { return '<button type="button" class="btn mini" data-t="' + t + '">' + t + ' px</button>'; }).join('');
    $('#oImages').innerHTML = T.NB_IMAGES.map(function (k) { return '<option value="' + k + '">' + (k === 1 ? 'Fixe' : k) + '</option>'; }).join('');
    $('#palette').innerHTML = '<option value="matiere">Celle de la matière</option>' + T.PALETTES.map(function (p) { return '<option value="' + p.id + '">' + echapper(p.nom) + '</option>'; }).join('');
    $('#echelle').innerHTML = ECHELLES.map(function (k) { return '<option value="' + k + '"' + (k === 8 ? ' selected' : '') + '>Agrandi ×' + k + '</option>'; }).join('');
    $('#astuce').textContent = 'R : nouvelle graine · V : variantes · G : garder · Espace : lecture';
    $('#bLire').textContent = '❚❚ Arrêter';
    construireMatieres();
    brancher();
    lireCollection();
    afficherCollection();
    E = location.hash.length > 1 ? T.depuisTexte(location.hash) : T.defauts('briques');
    majInterface();
    calculer();
    tic();
  }

  demarrer();
})();
