// Visionneuse BCH : la page. Ouvre les fichiers, les déballe (GARC, LZ11, paquets de Pokémon),
// les lit avec window.BCH, met le spécimen en vitrine et remplit sa fiche de collection.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var F3DS = window.FORMATS3DS || null;          // fourni par ../explorateur-romfs/formats.js, s'il est là
  var VITESSES = [0.25, 0.5, 1, 2, 4];
  var nf = function (n) { return Number(n).toLocaleString('fr-FR'); };

  var etat = {
    modele: null, ctl: null, sources: [], nomFichier: '', lot: null, piece: 0, pieces: null,
    fond: 'gris', grille: false, squelette: false, tournette: true, vitesse: 2, animation: -1
  };

  // ---------------------------------------------------------------- outils binaires
  function u16(o, p) { return o[p] | (o[p + 1] << 8); }
  function u32(o, p) { return (o[p] | (o[p + 1] << 8) | (o[p + 2] << 16) | (o[p + 3] << 24)) >>> 0; }
  function estGARC(o) { return o.length >= 4 && o[0] === 0x43 && o[1] === 0x52 && o[2] === 0x41 && o[3] === 0x47; } // « CRAG »

  // Paquets de Pokémon à deux lettres (PC, GR, MM, CP, AD, PT…) : nombre d'entrées sur 16 bits,
  // puis une table de positions (Ohana3DS, Containers/PkmnContainer.cs).
  function lireMini(o) {
    if (o.length < 12) return null;
    var a = o[0], b = o[1];
    if (a < 0x41 || a > 0x5a || b < 0x41 || b > 0x5a) return null;
    var n = u16(o, 2);
    if (n < 1 || n > 1024 || 4 + (n + 1) * 4 > o.length) return null;
    var debut = 4 + (n + 1) * 4, prec = 0, sortie = [];
    for (var i = 0; i <= n; i++) {
      var p = u32(o, 4 + i * 4);
      if (p < prec || p > o.length || (i === 0 && p < debut)) return null;
      prec = p;
    }
    for (var j = 0; j < n; j++) sortie.push(o.subarray(u32(o, 4 + j * 4), u32(o, 8 + j * 4)));
    return sortie;
  }

  // Cherche les BCH dans des octets : nus, en paquet, ou compressés en LZ11.
  function extraire(o, prof, sortie, notes) {
    if (!o || o.length < 4 || prof > 4) return;
    if (BCH.estBCH(o)) { sortie.push(o); return; }
    var mini = lireMini(o);
    if (mini) { mini.forEach(function (e) { extraire(e, prof + 1, sortie, notes); }); return; }
    if (o[0] === 0x11 || o[0] === 0x10) {
      if (!F3DS) { notes.lz = true; return; }
      try {
        if (F3DS.lz11.estCompresse(o)) extraire(F3DS.lz11.decompresser(o), prof + 1, sortie, notes);
      } catch (e) { /* ce n'était pas du LZ11 */ }
    }
  }

  // En-tête brut, sans relocalisation : nombre de modèles (pour chercher dans un GARC).
  function aUnModele(bch) {
    var contenu = u32(bch, 8);
    return contenu + 8 <= bch.length && u32(bch, contenu + 4) > 0;
  }

  // ---------------------------------------------------------------- lecture et fusion
  function lireTous(liste) {
    var lus = [], avert = [];
    liste.forEach(function (s) {
      try {
        var m = BCH.lire(s.octets);
        m.source = s.nom;
        lus.push(m);
      } catch (e) {
        avert.push((liste.length > 1 ? s.nom + ' : ' : '') + e.message);
      }
    });
    if (!lus.length) throw new Error(avert[0] || 'Aucun BCH lisible.');
    // Le premier fichier qui porte des maillages donne le modèle ; les autres prêtent
    // leurs textures et leurs animations (comme Ohana pour les paquets de Pokémon).
    var principal = lus.filter(function (m) { return m.maillages.length; })[0] || lus[0];
    var res = Object.assign({}, principal, { textures: [], animations: [], avertissements: [] });
    var vues = {};
    [principal].concat(lus.filter(function (m) { return m !== principal; })).forEach(function (m) {
      m.textures.forEach(function (t) { if (!vues[t.nom]) { vues[t.nom] = true; res.textures.push(t); } });
      m.animations.forEach(function (a) { a.source = m.source; res.animations.push(a); });
      m.avertissements.forEach(function (x) { res.avertissements.push((lus.length > 1 ? m.source + ' : ' : '') + x); });
    });
    avert.forEach(function (x) { res.avertissements.push(x); });
    res.nbFichiers = lus.length;
    return res;
  }

  // ---------------------------------------------------------------- ouverture
  function ouvrirListe(fichiers) {
    if (!fichiers || !fichiers.length) return;
    statut('Lecture de ' + (fichiers.length > 1 ? fichiers.length + ' fichiers' : fichiers[0].name) + '…');
    Promise.all(Array.prototype.map.call(fichiers, function (f) {
      return f.arrayBuffer().then(function (b) { return { nom: f.name, octets: new Uint8Array(b) }; });
    })).then(function (liste) {
      setTimeout(function () { charger(liste); }, 20);
    }, function (e) { erreur('Le fichier n’a pas pu être lu : ' + e.message); });
  }

  function charger(liste) {
    cacherErreur();
    etat.lot = null;
    $('lot').hidden = true;
    try {
      if (liste.length === 1 && estGARC(liste[0].octets)) {
        if (!F3DS) throw new Error('C’est un GARC. Pour l’ouvrir, il faut l’explorateur de romfs à côté de cette page ; en attendant, extrais-en le .bch.');
        var garc = F3DS.garc.lire(liste[0].octets);
        etat.lot = { nom: liste[0].nom, entrees: garc.entrees };
        var depart = 0;
        for (var i = 0; i < garc.entrees.length && i < 4000; i++) {
          var b = piece(i);
          if (b.bch.length && b.bch.some(aUnModele)) { depart = i; break; }
        }
        montrerPiece(depart);
        return;
      }
      var bchs = [], notes = {};
      liste.forEach(function (s) {
        var trouves = [];
        extraire(s.octets, 0, trouves, notes);
        trouves.forEach(function (o, k) { bchs.push({ nom: trouves.length > 1 ? s.nom + ' [' + (k + 1) + ']' : s.nom, octets: o }); });
      });
      if (!bchs.length) {
        if (notes.lz) throw new Error('Ce fichier est compressé en LZ11 : il faut l’explorateur de romfs à côté de cette page pour le décompresser.');
        throw new Error('Aucun modèle BCH là-dedans : le fichier ne commence pas par « BCH », et ce n’est ni un GARC ni un paquet de Pokémon qui en contienne.');
      }
      var m = lireTous(bchs);
      montrer(m, { nom: liste.map(function (s) { return s.nom; }).join(', '), taille: liste.reduce(function (t, s) { return t + s.octets.length; }, 0), fichiers: bchs });
    } catch (e) {
      erreur(e.message);
      statut('Rien n’a été mis en vitrine.');
    }
  }

  // Une pièce d'un GARC : toutes ses sous-entrées, déballées.
  function piece(i) {
    var sous = etat.lot.entrees[i] || [], bch = [], notes = {};
    sous.forEach(function (o) { extraire(o, 0, bch, notes); });
    return { bch: bch, notes: notes };
  }

  function montrerPiece(i) {
    var L = etat.lot, n = L.entrees.length;
    i = Math.max(0, Math.min(n - 1, i));
    etat.piece = i;
    $('lot').hidden = false;
    $('iPiece').max = n - 1;
    $('iPiece').value = i;
    $('lotTitre').textContent = 'Pièce';
    $('lotTotal').textContent = 'sur ' + nf(n) + ' (0 à ' + nf(n - 1) + ')';
    var p = piece(i), bchs = [], fin = i;
    p.bch.forEach(function (o, k) { bchs.push({ nom: 'pièce ' + i + (p.bch.length > 1 ? ' [' + (k + 1) + ']' : ''), octets: o }); });
    if (!bchs.length) {
      vitrineVide();
      erreur(p.notes.lz && !F3DS ? 'La pièce ' + i + ' est compressée en LZ11 et l’explorateur de romfs manque pour la décompresser.' : 'La pièce ' + i + ' ne contient aucun BCH.');
      fiche([['Provenance', L.nom + ', pièce ' + i], ['Contenu', 'aucun BCH']]);
      return;
    }
    // Réunir les pièces suivantes qui n'ont pas de modèle (textures, animations du même spécimen).
    if ($('cReunir').checked && bchs.some(function (b) { return aUnModele(b.octets); })) {
      for (var j = i + 1; j < n && j <= i + 12; j++) {
        var q = piece(j);
        if (!q.bch.length || q.bch.some(aUnModele)) break;
        q.bch.forEach(function (o, k) { bchs.push({ nom: 'pièce ' + j + (q.bch.length > 1 ? ' [' + (k + 1) + ']' : ''), octets: o }); });
        fin = j;
      }
    }
    try {
      var m = lireTous(bchs);
      cacherErreur();
      montrer(m, { nom: L.nom, piece: i, fin: fin, taille: bchs.reduce(function (t, b) { return t + b.octets.length; }, 0), fichiers: bchs });
    } catch (e) {
      vitrineVide();
      erreur('Pièce ' + i + ' : ' + e.message);
    }
  }

  function chercherModele(sens) {
    if (!etat.lot) return;
    var n = etat.lot.entrees.length;
    for (var i = etat.piece + sens; i >= 0 && i < n; i += sens) {
      var p = piece(i);
      if (p.bch.some(aUnModele)) { montrerPiece(i); return; }
    }
    statut('Pas d’autre pièce avec un modèle dans ce sens.');
  }

  // ---------------------------------------------------------------- mise en vitrine
  function vider() {
    if (etat.ctl) { etat.ctl.detruire(); etat.ctl = null; }
    if (etat.ctlVide) { etat.ctlVide.detruire(); etat.ctlVide = null; }
    etat.modele = null;
    var ancienne = $('toile'), neuve = ancienne.cloneNode(false);
    ancienne.parentNode.replaceChild(neuve, ancienne);
    $('verre').classList.add('vierge');
    $('bCapture').disabled = $('bObj').disabled = true;
  }

  // La vitrine vide garde sa tournette : un modèle sans maillage, posé sur le plateau.
  function vitrineVide() {
    vider();
    try {
      etat.ctlVide = BCH.rendre($('toile'), { maillages: [], materiaux: [], textures: [], squelette: [], animations: [] },
        { fond: etat.fond, grille: etat.grille, tournette: etat.tournette, socle: true, interactions: false });
      etat.ctlVide.demarrer();
    } catch (e) {
      $('sansExplorateur').hidden = false;
      $('sansExplorateur').textContent = e.message;
    }
  }

  function montrer(m, infos) {
    vider();
    etat.modele = m;
    etat.infos = infos;
    etat.animation = -1;
    $('vide').hidden = true;
    $('verre').classList.remove('vierge');
    try {
      etat.ctl = BCH.rendre($('toile'), m, {
        fond: etat.fond, grille: etat.grille, squelette: etat.squelette, tournette: etat.tournette, socle: true,
        surImage: majLecteur
      });
    } catch (e) {
      erreur(e.message);
      return;
    }
    etat.ctl.vitesse(VITESSES[etat.vitesse]);
    etat.ctl.vue('ensemble');
    etat.ctl.demarrer();
    choisirVue('ensemble');
    $('bCapture').disabled = $('bObj').disabled = false;
    remplirPlaque(m, infos);
    remplirCartel(m, infos);
    majLecteur(etat.ctl.etat());
    var sommets = m.maillages.reduce(function (t, x) { return t + x.sommets; }, 0);
    statut((m.nom || infos.nom) + ' en vitrine : ' + nf(m.maillages.length) + ' maillages, ' + nf(sommets) + ' sommets.');
  }

  function totaux(m) {
    var s = 0, f = 0;
    m.maillages.forEach(function (x) { s += x.sommets; f += x.faces; });
    return { sommets: s, faces: f };
  }

  function nomCourt(nom) { return nom.replace(/^.*[\\/]/, ''); }

  function remplirPlaque(m, infos) {
    var t = totaux(m);
    $('pNom').textContent = infos.piece !== undefined ? nomCourt(infos.nom) + ', pièce ' + infos.piece : nomCourt(infos.nom);
    $('pModele').textContent = m.nom ? 'modèle « ' + m.nom + ' »' : (m.maillages.length ? 'modèle sans nom' : 'aucun modèle dans ce fichier');
    var morceaux = [nf(t.sommets) + ' sommets', nf(t.faces) + ' faces', nf(m.squelette.length) + ' os', nf(m.animations.length) + (m.animations.length > 1 ? ' animations' : ' animation')];
    $('pReleve').textContent = morceaux.join(', ');
    $('pNom').title = $('pNom').textContent;
  }

  // Numéro d'inventaire : une empreinte FNV-1a des premiers octets, pour reconnaître un fichier.
  function inventaire(infos) {
    var h = 0x811c9dc5, o = infos.fichiers[0].octets, n = Math.min(o.length, 65536);
    for (var i = 0; i < n; i++) { h ^= o[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    var x = h.toString(16).toUpperCase().padStart(8, '0');
    return 'N° d’inventaire ' + x.slice(0, 4) + '-' + x.slice(4);
  }

  function fiche(lignes) {
    var dl = $('fiche');
    dl.textContent = '';
    lignes.forEach(function (l) {
      var dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = l[0]; dd.textContent = l[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
  }

  function remplirCartel(m, infos) {
    $('inventaire').textContent = inventaire(infos);
    var v = m.version;
    var provenance = infos.piece !== undefined
      ? nomCourt(infos.nom) + ', pièce ' + infos.piece + (infos.fin > infos.piece ? ' (réunie avec les pièces ' + (infos.piece + 1) + ' à ' + infos.fin + ')' : '')
      : infos.nom;
    var lignes = [
      ['Provenance', provenance],
      ['Format', 'BCH version 0x' + v.retro.toString(16) + (v.retro >= 0x21 ? ' (génération de ROSA)' : v.retro <= 7 ? ' (génération de X/Y)' : '') + ', convertisseur ' + v.convertisseur],
      ['Modèle', m.nom ? m.nom + (m.nbModeles > 1 ? ' (1 sur ' + m.nbModeles + ')' : '') : '—'],
      ['Matériaux', nf(m.materiaux.length)],
      ['Poids', nf(infos.taille) + ' octets' + (m.nbFichiers > 1 ? ' en ' + m.nbFichiers + ' BCH' : '')]
    ];
    fiche(lignes);

    // Maillages
    var ul = $('lMaillages');
    ul.textContent = '';
    $('nMaillages').textContent = m.maillages.length ? '(' + m.maillages.length + ')' : '';
    if (!m.maillages.length) ul.innerHTML = '<li class="rien">Aucun : ce fichier ne porte que des textures ou des animations.</li>';
    m.maillages.forEach(function (x, i) {
      var li = document.createElement('li');
      var lab = document.createElement('label');
      lab.className = 'case';
      var mat = m.materiaux[x.materiau];
      var peaux = x.sousMaillages.map(function (s) { return s.peau; }).filter(function (p, k, a) { return a.indexOf(p) === k; });
      lab.innerHTML = '<input type="checkbox"' + (x.visible !== false ? ' checked' : '') + '><i></i><span><span class="nom"></span><span class="detail"></span></span>';
      lab.querySelector('.nom').textContent = x.nom;
      lab.querySelector('.detail').textContent = nf(x.sommets) + ' sommets, ' + nf(x.faces) + ' faces' + (mat ? ', ' + mat.nom : '') + (peaux.length && peaux[0] !== 'aucune' ? ', peau ' + peaux.join(' et ') : '');
      lab.title = x.attributs.map(function (a) { return a.nom + ' (' + a.format + (a.fixe ? '' : ' × ' + a.elements) + ')'; }).join(', ');
      var cb = lab.querySelector('input');
      if (x.visible === false) li.classList.add('cache');
      cb.addEventListener('change', function () {
        li.classList.toggle('cache', !cb.checked);
        etat.ctl.cacher(i, !cb.checked);
      });
      li.appendChild(lab);
      ul.appendChild(li);
    });
    if (m.maillages.length > 1) {
      var li2 = document.createElement('li');
      li2.innerHTML = '<div class="boutons-liste"><button type="button" class="papier petit" data-tous="1">tout montrer</button><button type="button" class="papier petit" data-tous="0">tout cacher</button></div>';
      li2.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var montre = b.dataset.tous === '1';
        ul.querySelectorAll('li').forEach(function (l, i) {
          var c = l.querySelector('input'); if (!c) return;
          c.checked = montre; l.classList.toggle('cache', !montre); etat.ctl.cacher(i, !montre);
        });
      });
      ul.appendChild(li2);
    }

    // Textures
    var tx = $('lTextures');
    tx.textContent = '';
    $('nTextures').textContent = m.textures.length ? '(' + m.textures.length + ')' : '';
    if (!m.textures.length) tx.innerHTML = '<p class="rien">Aucune dans ce fichier.</p>';
    m.textures.forEach(function (t) {
      var fig = document.createElement('figure');
      var cadre = document.createElement('div');
      cadre.className = 'cadre';
      if (t.rgba) {
        var c = document.createElement('canvas');
        c.width = t.largeur; c.height = t.hauteur;
        c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(t.rgba), t.largeur, t.hauteur), 0, 0);
        cadre.appendChild(c);
        fig.title = 'Cliquer pour agrandir';
      } else {
        fig.classList.add('illisible');
        cadre.textContent = '✗';
        fig.title = t.erreur || 'illisible';
      }
      var cap = document.createElement('figcaption');
      cap.textContent = t.nom;
      var sp = document.createElement('span');
      sp.textContent = t.largeur + ' × ' + t.hauteur + ', ' + t.format;
      cap.appendChild(sp);
      fig.appendChild(cadre); fig.appendChild(cap);
      fig.addEventListener('click', function () { if (t.rgba) fig.classList.toggle('grande'); });
      tx.appendChild(fig);
    });

    // Squelette
    var sq = $('lSquelette');
    sq.textContent = '';
    $('nOs').textContent = m.squelette.length ? '(' + m.squelette.length + ' os)' : '';
    if (!m.squelette.length) sq.innerHTML = '<p class="rien">Aucun os : le modèle est rigide.</p>';
    else {
      var p = document.createElement('p');
      p.className = 'rien';
      p.style.fontStyle = 'normal';
      var racines = m.squelette.filter(function (b) { return b.parent < 0; }).length;
      p.textContent = nf(m.squelette.length) + ' os, ' + racines + (racines > 1 ? ' racines' : ' racine') + '. Coche « Squelette » sur la corniche pour les voir dans la vitrine.';
      sq.appendChild(p);
      var det = document.createElement('details');
      det.className = 'arbre-os';
      det.innerHTML = '<summary>Arbre des os</summary><ul></ul>';
      var ulOs = det.querySelector('ul');
      var enfants = {};
      m.squelette.forEach(function (b, i) { (enfants[b.parent] = enfants[b.parent] || []).push(i); });
      (function parcourir(parent, prof) {
        (enfants[parent] || []).forEach(function (i) {
          var li = document.createElement('li');
          li.textContent = m.squelette[i].nom || ('os ' + i);
          li.style.paddingLeft = (prof * 12) + 'px';
          if (prof === 0) li.className = 'racine';
          ulOs.appendChild(li);
          if (prof < 64) parcourir(i, prof + 1);
        });
      })(-1, 0);
      sq.appendChild(det);
    }

    // Animations
    var la = $('lAnimations');
    la.textContent = '';
    $('nAnimations').textContent = m.animations.length ? '(' + m.animations.length + ')' : '';
    if (!m.animations.length) la.innerHTML = '<li class="rien">Aucune animation de squelette.</li>';
    else {
      ajouterAnim(la, -1, 'pose de repos', '');
      m.animations.forEach(function (a, i) {
        ajouterAnim(la, i, a.nom || ('animation ' + (i + 1)), Math.round(a.images) + ' images' + (a.boucle ? ', en boucle' : ''));
      });
    }

    // Observations
    var obs = $('lObservations');
    obs.textContent = '';
    var lignesObs = m.avertissements.slice();
    var noms = {};
    m.textures.forEach(function (t) { noms[t.nom] = true; });
    var manquantes = {};
    m.materiaux.forEach(function (mat) { var n = mat.textures && mat.textures[0]; if (n && !noms[n]) manquantes[n] = true; });
    Object.keys(manquantes).forEach(function (n) {
      lignesObs.push('Texture « ' + n + ' » absente : elle est sans doute dans un autre fichier du même GARC. Le maillage reste blanc.');
    });
    var inconnus = 0;
    var nomsOs = {};
    m.squelette.forEach(function (b) { nomsOs[b.nom] = true; });
    m.animations.forEach(function (a) { a.os.forEach(function (o) { if (m.squelette.length && !nomsOs[o.nom]) inconnus++; }); });
    if (inconnus) lignesObs.push(inconnus + ' pistes d’animation visent des os que ce squelette n’a pas : elles sont sans effet.');
    if (!lignesObs.length) obs.innerHTML = '<li class="rien">Lu sans difficulté.</li>';
    lignesObs.forEach(function (x) {
      var li = document.createElement('li');
      li.className = 'non-lu';
      li.textContent = x;
      obs.appendChild(li);
    });
  }

  function ajouterAnim(ul, i, nom, duree) {
    var li = document.createElement('li');
    var b = document.createElement('button');
    b.type = 'button';
    b.dataset.anim = i;
    b.setAttribute('aria-pressed', i === etat.animation ? 'true' : 'false');
    b.innerHTML = '<span class="nom"></span><span class="duree"></span>';
    b.querySelector('.nom').textContent = nom;
    b.querySelector('.duree').textContent = duree;
    b.addEventListener('click', function () { choisirAnimation(i); });
    li.appendChild(b);
    ul.appendChild(li);
  }

  function choisirAnimation(i) {
    if (!etat.ctl) return;
    etat.animation = i;
    etat.ctl.animer(i, VITESSES[etat.vitesse]);
    document.querySelectorAll('#lAnimations button').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.anim === i)); });
  }

  // ---------------------------------------------------------------- lecteur : manivelle et réglettes
  function majLecteur(e) {
    var actif = !!etat.modele && e.animation >= 0;
    var anim = actif ? etat.modele.animations[e.animation] : null;
    ['manivelle', 'rImage', 'bPrec', 'bSuiv', 'bLecture'].forEach(function (id) { $(id).disabled = !actif; });
    if (!anim) {
      $('lEtat').textContent = etat.modele && etat.modele.animations.length ? 'Choisis une animation dans la fiche' : 'Aucune animation';
      $('oImage').textContent = '';
      $('rImage').value = 0;
      $('bLecture').textContent = 'Lancer';
      $('bLecture').setAttribute('aria-pressed', 'false');
      $('manivelle').classList.remove('tourne');
      return;
    }
    var total = Math.max(1, Math.round(anim.images));
    $('rImage').max = total;
    $('rImage').value = Math.floor(e.image);
    $('lEtat').textContent = anim.nom;
    $('lEtat').title = anim.nom;
    $('oImage').textContent = 'image ' + Math.floor(e.image) + ' / ' + total;
    $('bLecture').textContent = e.lecture ? 'Arrêter' : 'Lancer';
    $('bLecture').setAttribute('aria-pressed', String(e.lecture));
    $('manivelle').classList.toggle('tourne', e.lecture);
    $('bras').style.transform = 'rotate(' + ((e.image / 24) * 360 % 360) + 'deg)';
  }

  function avancer(n) {
    if (!etat.ctl) return;
    var e = etat.ctl.etat();
    if (e.animation < 0) return;
    etat.ctl.image(Math.round(e.image) + n);
  }

  (function manivelle() {
    var m = $('manivelle'), prise = null;
    function angle(ev) {
      var r = m.getBoundingClientRect();
      return Math.atan2(ev.clientY - (r.top + r.height / 2), ev.clientX - (r.left + r.width / 2));
    }
    m.addEventListener('pointerdown', function (ev) {
      if (m.disabled) return;
      m.setPointerCapture(ev.pointerId);
      prise = { a: angle(ev), cumul: 0, x: ev.clientX, y: ev.clientY, bouge: false };
      ev.preventDefault();
    });
    m.addEventListener('pointermove', function (ev) {
      if (!prise) return;
      var a = angle(ev), d = a - prise.a;
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      prise.a = a;
      prise.cumul += d;
      if (Math.hypot(ev.clientX - prise.x, ev.clientY - prise.y) > 4) prise.bouge = true;
      var pas = prise.cumul / (2 * Math.PI) * 24; // un tour de manivelle : 24 images
      if (Math.abs(pas) >= 1) {
        var n = pas > 0 ? Math.floor(pas) : Math.ceil(pas);
        prise.cumul -= n * 2 * Math.PI / 24;
        avancer(n);
      }
    });
    function lacher(ev) {
      if (!prise) return;
      if (!prise.bouge && ev.type === 'pointerup' && etat.ctl) etat.ctl.lecture();
      prise = null;
    }
    m.addEventListener('pointerup', lacher);
    m.addEventListener('pointercancel', lacher);
    m.addEventListener('click', function (ev) { if (ev.detail === 0 && etat.ctl) etat.ctl.lecture(); }); // clavier
  })();

  $('rImage').addEventListener('input', function () { if (etat.ctl) etat.ctl.image(+this.value); });
  $('rVitesse').addEventListener('input', function () {
    etat.vitesse = +this.value;
    var v = VITESSES[etat.vitesse];
    $('oVitesse').textContent = '× ' + (v === 0.25 ? '¼' : v === 0.5 ? '½' : v);
    if (etat.ctl) etat.ctl.vitesse(v);
  });
  $('bPrec').addEventListener('click', function () { avancer(-1); });
  $('bSuiv').addEventListener('click', function () { avancer(1); });
  $('bLecture').addEventListener('click', function () { if (etat.ctl) etat.ctl.lecture(); });

  // ---------------------------------------------------------------- vues, fond, cases
  function choisirVue(nom) {
    document.querySelectorAll('#gVue button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.vue === nom)); });
  }
  $('gVue').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    choisirVue(b.dataset.vue);
    if (etat.ctl) etat.ctl.vue(b.dataset.vue);
  });
  function choisirFond(nom) {
    etat.fond = nom;
    document.querySelectorAll('#gFond button').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.fond === nom)); });
    $('verre').style.background = { gris: '#787875', noir: '#131313', blanc: '#f2f2ef', damier: '#b8b8b5' }[nom];
    if (etat.ctl) etat.ctl.fond(nom);
    if (etat.ctlVide) etat.ctlVide.fond(nom);
  }
  $('gFond').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) choisirFond(b.dataset.fond); });
  $('cGrille').addEventListener('change', function () { etat.grille = this.checked; if (etat.ctl) etat.ctl.grille(this.checked); if (etat.ctlVide) etat.ctlVide.grille(this.checked); });
  $('cSquelette').addEventListener('change', function () { etat.squelette = this.checked; if (etat.ctl) etat.ctl.squelette(this.checked); });
  $('cTournette').addEventListener('change', function () { etat.tournette = this.checked; if (etat.ctl) etat.ctl.tournette(this.checked); if (etat.ctlVide) etat.ctlVide.tournette(this.checked); });

  // ---------------------------------------------------------------- fichiers : bouton, glisser-déposer
  function choisir() { $('iFichier').click(); }
  $('bOuvrir').addEventListener('click', choisir);
  $('bChoisir').addEventListener('click', choisir);
  $('iFichier').addEventListener('change', function () { ouvrirListe(this.files); this.value = ''; });
  $('bCube').addEventListener('click', function () { cubeEssai(); });
  var profondeurGlisse = 0;
  document.addEventListener('dragenter', function (e) { if (aDesFichiers(e)) { profondeurGlisse++; $('depot').hidden = false; } });
  document.addEventListener('dragleave', function () { if (--profondeurGlisse <= 0) { profondeurGlisse = 0; $('depot').hidden = true; } });
  document.addEventListener('dragover', function (e) { if (aDesFichiers(e)) e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    if (!aDesFichiers(e)) return;
    e.preventDefault();
    profondeurGlisse = 0;
    $('depot').hidden = true;
    ouvrirListe(e.dataTransfer.files);
  });
  function aDesFichiers(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }

  $('bPiecePrec').addEventListener('click', function () { if (etat.lot) montrerPiece(etat.piece - 1); });
  $('bPieceSuiv').addEventListener('click', function () { if (etat.lot) montrerPiece(etat.piece + 1); });
  $('bModeleSuiv').addEventListener('click', function () { chercherModele(1); });
  $('iPiece').addEventListener('change', function () { if (etat.lot) montrerPiece(+this.value || 0); });
  $('cReunir').addEventListener('change', function () { if (etat.lot) montrerPiece(etat.piece); });

  function cubeEssai() {
    if (!window.FabriqueBCH) return;
    var o = window.FabriqueBCH.cube({ version: 0x21 });
    charger([{ nom: 'cube_d_essai.bch', octets: o }]);
  }

  // ---------------------------------------------------------------- capture et export
  function telecharger(nom, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nom;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function base() {
    var n = etat.modele && etat.modele.nom || (etat.infos && nomCourt(etat.infos.nom).replace(/\.[^.]*$/, '')) || 'modele';
    return n.replace(/[^\w\-]+/g, '_');
  }
  $('bCapture').addEventListener('click', function () {
    if (!etat.ctl) return;
    var url = etat.ctl.capture();
    fetchDataURL(url).then(function (b) { telecharger(base() + '.png', b); statut('Capture enregistrée : ' + base() + '.png'); });
  });
  function fetchDataURL(url) {
    var bin = atob(url.split(',')[1]), o = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
    return Promise.resolve(new Blob([o], { type: 'image/png' }));
  }

  // CRC-32 et archive ZIP « stockée » (sans compression), assez pour un OBJ et ses PNG.
  var TABLE_CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(o) { var c = 0xffffffff; for (var i = 0; i < o.length; i++) c = TABLE_CRC[(c ^ o[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zip(fichiers) {
    var parts = [], central = [], pos = 0, enc = new TextEncoder();
    fichiers.forEach(function (f) {
      var nom = enc.encode(f.nom), crc = crc32(f.octets), n = f.octets.length;
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true); h.setUint16(26, nom.length, true);
      parts.push(new Uint8Array(h.buffer), nom, f.octets);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true); c.setUint16(28, nom.length, true);
      c.setUint32(42, pos, true);
      central.push(new Uint8Array(c.buffer), nom);
      pos += 30 + nom.length + n;
    });
    var tailleC = central.reduce(function (t, x) { return t + x.length; }, 0);
    var fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, fichiers.length, true); fin.setUint16(10, fichiers.length, true);
    fin.setUint32(12, tailleC, true); fin.setUint32(16, pos, true);
    return new Blob(parts.concat(central, [new Uint8Array(fin.buffer)]), { type: 'application/zip' });
  }

  function pngTexture(t) {
    return new Promise(function (ok) {
      var c = document.createElement('canvas');
      c.width = t.largeur; c.height = t.hauteur;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(t.rgba), t.largeur, t.hauteur), 0, 0);
      c.toBlob(function (b) { b.arrayBuffer().then(function (a) { ok(new Uint8Array(a)); }); }, 'image/png');
    });
  }

  $('bObj').addEventListener('click', function () {
    var m = etat.modele;
    if (!m || !etat.ctl) return;
    var I = BCH._interne, e = etat.ctl.etat();
    var anim = e.animation >= 0 ? m.animations[e.animation] : null;
    var mondes = I.poseAnimee(m.squelette, anim, e.image);
    var peaux = m.squelette.length ? I.matricesPeau(m.squelette, mondes) : null;
    var nom = base();
    var obj = ['# ' + nom + ', exporté par la Visionneuse BCH', '# pose : ' + (anim ? anim.nom + ', image ' + Math.floor(e.image) : 'repos'), 'mtllib ' + nom + '.mtl'];
    var mtl = ['# matériaux de ' + nom];
    var decal = 1, utiles = {};
    var caches = Array.prototype.map.call(document.querySelectorAll('#lMaillages input'), function (c) { return !c.checked; });
    m.materiaux.forEach(function (mat, i) {
      mtl.push('', 'newmtl ' + (mat.nom || 'materiau_' + i).replace(/\s/g, '_'), 'Kd 1 1 1', 'Ka 0 0 0', 'Ks 0 0 0');
      var t = mat.textures && mat.textures[0];
      var tex = m.textures.filter(function (x) { return x.nom === t && x.rgba; })[0];
      if (tex) { mtl.push('map_Kd textures/' + tex.nom + '.png'); utiles[tex.nom] = tex; }
    });
    var M = m.monde;
    m.maillages.forEach(function (x, i) {
      if (caches[i]) return;
      var P = new Float32Array(x.sommets * 3), N = new Float32Array(x.sommets * 3);
      var src = Object.assign({}, x);
      if (!src.normales) src.normales = null;
      I.appliquerPeau(src, peaux, P, x.normales ? N : null);
      var mat = m.materiaux[x.materiau];
      obj.push('', 'o ' + x.nom.replace(/\s/g, '_') + '_' + i);
      for (var v = 0; v < x.sommets; v++) {
        var px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
        obj.push('v ' + (M[0] * px + M[4] * py + M[8] * pz + M[12]).toFixed(5) + ' ' + (M[1] * px + M[5] * py + M[9] * pz + M[13]).toFixed(5) + ' ' + (M[2] * px + M[6] * py + M[10] * pz + M[14]).toFixed(5));
      }
      var uv = mat && mat.uv;
      if (x.uvs) for (var t = 0; t < x.sommets; t++) {
        var u = x.uvs[t * 2], w = x.uvs[t * 2 + 1];
        if (uv) { var u2 = uv[0] * u + uv[2] * w + uv[4], w2 = uv[1] * u + uv[3] * w + uv[5]; u = u2; w = w2; }
        obj.push('vt ' + u.toFixed(5) + ' ' + w.toFixed(5));
      }
      if (x.normales) for (var k = 0; k < x.sommets; k++) obj.push('vn ' + N[k * 3].toFixed(4) + ' ' + N[k * 3 + 1].toFixed(4) + ' ' + N[k * 3 + 2].toFixed(4));
      if (mat) obj.push('usemtl ' + (mat.nom || 'materiau_' + x.materiau).replace(/\s/g, '_'));
      for (var f = 0; f < x.indices.length; f += 3) {
        var s = [x.indices[f] + decal, x.indices[f + 1] + decal, x.indices[f + 2] + decal].map(function (a) {
          return a + (x.uvs || x.normales ? '/' + (x.uvs ? a : '') + (x.normales ? '/' + a : '') : '');
        });
        obj.push('f ' + s.join(' '));
      }
      decal += x.sommets;
    });
    var enc = new TextEncoder();
    var fichiers = [{ nom: nom + '.obj', octets: enc.encode(obj.join('\n') + '\n') }, { nom: nom + '.mtl', octets: enc.encode(mtl.join('\n') + '\n') }];
    statut('Préparation de l’archive…');
    Promise.all(Object.keys(utiles).map(function (k) {
      return pngTexture(utiles[k]).then(function (o) { fichiers.push({ nom: 'textures/' + k + '.png', octets: o }); });
    })).then(function () {
      telecharger(nom + '.zip', zip(fichiers));
      statut('Export enregistré : ' + nom + '.zip (OBJ, MTL et ' + Object.keys(utiles).length + ' textures en PNG).');
    });
  });

  // ---------------------------------------------------------------- messages
  function statut(t) { $('statut').textContent = t; }
  function erreur(t) { var e = $('erreur'); e.textContent = t; e.hidden = false; }
  function cacherErreur() { $('erreur').hidden = true; }

  // ---------------------------------------------------------------- clavier
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'range')) return;
    var k = e.key;
    if (k === 'o' || k === 'O') { choisir(); e.preventDefault(); return; }
    if (!etat.ctl) return;
    var vues = { '0': 'ensemble', Home: 'ensemble', '1': 'face', '2': 'profil', '3': 'dessus' };
    if (vues[k]) { choisirVue(vues[k]); etat.ctl.vue(vues[k]); e.preventDefault(); return; }
    if (k === ' ' && t.tagName !== 'BUTTON') { etat.ctl.lecture(); e.preventDefault(); return; }
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && t.type !== 'range') { avancer(k === 'ArrowLeft' ? -1 : 1); e.preventDefault(); return; }
    if (k === 'g' || k === 'G') { $('cGrille').click(); return; }
    if (k === 's' || k === 'S') { $('cSquelette').click(); return; }
    if (k === 't' || k === 'T') { $('cTournette').click(); return; }
    if (k === '+' || k === '=') { etat.ctl.zoomer(0.85); return; }
    if (k === '-') { etat.ctl.zoomer(1 / 0.85); return; }
  });

  // ---------------------------------------------------------------- démarrage
  if (!F3DS) {
    $('sansExplorateur').hidden = false;
    $('bOuvrir').title = 'Ouvrir un .bch (sans l’explorateur de romfs, ni GARC ni LZ11) (O)';
  }
  if (!window.FabriqueBCH) $('bCube').hidden = true;
  vitrineVide();
  majLecteur({ animation: -1, image: 0, lecture: false });

  // Pour les tests et le pilote de captures : charger des octets sans passer par le sélecteur.
  window.visionneuse = {
    charger: function (octets, nom) { charger([{ nom: nom || 'fichier.bch', octets: octets }]); },
    cubeEssai: cubeEssai,
    etat: function () { return etat.ctl ? etat.ctl.etat() : null; },
    controleur: function () { return etat.ctl; },
    animer: choisirAnimation
  };
})();
