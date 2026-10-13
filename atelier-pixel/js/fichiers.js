(function () {
  'use strict';

  var A = window.Atelier, U = A.ui;

  var CLE = 'atelier-pixel.projet';
  var CLE_NOM = 'atelier-pixel.nom';     // nom de fichier du sprite repris
  var DELAI_SAUVE = 700;                 // millisecondes d'inactivité avant la sauvegarde automatique
  var PREREGLAGES = [16, 32, 64, 128];
  var ECHELLES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];

  var $ = function (s) { return document.querySelector(s); };
  function echapper(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  U.nom = 'sprite';     // base des noms de fichiers téléchargés

  // ---------- Fenêtres ----------
  // o : { titre, html, ok (libellé, absent pour une simple information), action(formulaire), pret(formulaire) }.
  // action rend un texte pour signaler une erreur et garder la fenêtre ouverte.
  U.dialogue = function (o) {
    var m = $('#modal'), f, premier;
    m.innerHTML = '<form class="fen" novalidate><h2>' + echapper(o.titre) + '</h2><div class="corps">' + o.html + '</div>' +
      '<p class="erreur" hidden></p><div class="pied">' +
      (o.ok ? '<button type="button" class="btn" data-fermer>Annuler</button><button type="submit" class="btn fort">' + echapper(o.ok) + '</button>'
        : '<button type="button" class="btn fort" data-fermer>Fermer</button>') + '</div></form>';
    m.hidden = false;
    f = m.querySelector('form');
    f.addEventListener('submit', function (e) {
      var r;
      e.preventDefault();
      if (!o.action) { U.fermer(); return; }
      try { r = o.action(f); } catch (err) { r = err.message || String(err); }
      if (typeof r === 'string') {
        f.querySelector('.erreur').textContent = r;
        f.querySelector('.erreur').hidden = false;
      } else U.fermer();
    });
    if (o.pret) o.pret(f);
    premier = f.querySelector('input:not([type=radio]):not([type=checkbox]), select') || f.querySelector('button.fort');
    if (premier) { premier.focus(); if (premier.select) premier.select(); }
    f.scrollTop = 0;
  };

  U.fermer = function () {
    $('#modal').hidden = true;
    $('#modal').innerHTML = '';
  };
  U.fenetreOuverte = function () { return !$('#modal').hidden; };
  U.alerte = function (titre, texte) { U.dialogue({ titre: titre, html: '<p>' + echapper(texte) + '</p>' }); };

  function nombre(f, nom) { return Number(f.elements[nom].value); }
  function entier(f, nom, min, max) {
    var v = Math.round(nombre(f, nom));
    if (!(v >= min && v <= max)) throw new Error('« ' + f.elements[nom].dataset.nom + ' » doit être un nombre entre ' + min + ' et ' + max + '.');
    return v;
  }
  function champ(libelle, nom, valeur, min, max) {
    return '<label class="champ">' + libelle + ' <input type="number" name="' + nom + '" data-nom="' + libelle + '" value="' + valeur + '" min="' + min + '" max="' + max + '" step="1"></label>';
  }
  function choixEchelle(defaut) {
    return '<label class="champ">Agrandissement <select name="echelle">' + ECHELLES.map(function (k) {
      return '<option value="' + k + '"' + (k === defaut ? ' selected' : '') + '>×' + k + '</option>';
    }).join('') + '</select></label>';
  }
  function echelleConseillee() {
    var cote = Math.max(A.doc.w, A.doc.h), k = 1, i;
    for (i = 0; i < ECHELLES.length; i++) if (cote * ECHELLES[i] <= 512) k = ECHELLES[i];
    return k;
  }

  // ---------- Document ----------
  U.apresChargement = function () {
    U.lire(false);
    U.rafraichir();
    U.ajuster();
  };

  U.dlgNouveau = function () {
    U.dialogue({
      titre: 'Nouveau sprite', ok: 'Créer',
      html: '<p class="rang">' + PREREGLAGES.map(function (n) { return '<button type="button" class="btn" data-cote="' + n + '">' + n + ' × ' + n + '</button>'; }).join('') + '</p>' +
        '<p class="rang">' + champ('Largeur', 'w', 32, 1, A.TAILLE_MAX) + champ('Hauteur', 'h', 32, 1, A.TAILLE_MAX) + '</p>' +
        '<p class="note">Le sprite en cours sera remplacé : enregistre-le d\'abord si tu veux le garder.</p>',
      pret: function (f) {
        f.addEventListener('click', function (e) {
          var b = e.target.closest('[data-cote]');
          if (b) { f.elements.w.value = f.elements.h.value = b.dataset.cote; }
        });
      },
      action: function (f) {
        A.docNouveau(entier(f, 'w', 1, A.TAILLE_MAX), entier(f, 'h', 1, A.TAILLE_MAX));
        U.nom = 'sprite';
        U.apresChargement();
      }
    });
  };

  U.dlgRedimensionner = function () {
    var d = A.doc, cases = '', i;
    for (i = 0; i < 9; i++) cases += '<label><input type="radio" name="ancre" value="' + i + '"' + (i === 4 ? ' checked' : '') + '><span></span></label>';
    U.dialogue({
      titre: 'Redimensionner la toile', ok: 'Redimensionner',
      html: '<p class="rang">' + champ('Largeur', 'w', d.w, 1, A.TAILLE_MAX) + champ('Hauteur', 'h', d.h, 1, A.TAILLE_MAX) + '</p>' +
        '<div class="rang"><span>Position du dessin actuel</span><div class="ancres">' + cases + '</div></div>' +
        '<p class="note">La toile change de taille, les pixels gardent la leur. Ce qui dépasse est coupé.</p>',
      action: function (f) {
        var a = Number(f.elements.ancre.value);
        if (!A.redimensionner(entier(f, 'w', 1, A.TAILLE_MAX), entier(f, 'h', 1, A.TAILLE_MAX), (a % 3) / 2, Math.floor(a / 3) / 2)) return;
        U.ajuster();
      }
    });
  };

  U.dlgEchelle = function () {
    var d = A.doc;
    U.dialogue({
      titre: 'Mettre le sprite à l\'échelle', ok: 'Appliquer',
      html: '<p class="rang">' + [['×2', 2], ['×3', 3], ['×4', 4], ['÷2', 0.5]].map(function (k) { return '<button type="button" class="btn" data-k="' + k[1] + '">' + k[0] + '</button>'; }).join('') + '</p>' +
        '<p class="rang">' + champ('Largeur', 'w', d.w, 1, A.TAILLE_MAX) + champ('Hauteur', 'h', d.h, 1, A.TAILLE_MAX) + '</p>' +
        '<p class="note">Tout le sprite est agrandi ou réduit au plus proche voisin, sans lissage.</p>',
      pret: function (f) {
        f.addEventListener('click', function (e) {
          var b = e.target.closest('[data-k]');
          if (!b) return;
          f.elements.w.value = Math.max(1, Math.min(A.TAILLE_MAX, Math.round(d.w * Number(b.dataset.k))));
          f.elements.h.value = Math.max(1, Math.min(A.TAILLE_MAX, Math.round(d.h * Number(b.dataset.k))));
        });
      },
      action: function (f) {
        if (A.mettreEchelle(entier(f, 'w', 1, A.TAILLE_MAX), entier(f, 'h', 1, A.TAILLE_MAX))) U.ajuster();
      }
    });
  };

  // ---------- Téléchargements ----------
  function telecharger(blob, nom) {
    var a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = nom;
    // Ce clic-là ne regarde pas la page : il refermerait un menu ouvert entre-temps.
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
    U.message('Fichier « ' + nom + ' » téléchargé.');
  }

  function telechargerPng(pix, w, h, nom) {
    var c = document.createElement('canvas');
    U.peindre(c, pix, w, h);
    c.toBlob(function (b) {
      if (b) telecharger(b, nom); else U.alerte('Export impossible', 'Le navigateur n\'a pas pu fabriquer l\'image.');
    }, 'image/png');
  }

  U.enregistrer = function () {
    telecharger(new Blob([JSON.stringify(A.versProjet())], { type: 'application/json' }), U.nom + '.json');
  };

  U.dlgPng = function () {
    U.dialogue({
      titre: 'Exporter l\'image en PNG', ok: 'Exporter',
      html: '<p class="rang">' + choixEchelle(echelleConseillee()) + '</p><p class="note">Image ' + (A.doc.iImage + 1) + ', calques visibles, fond transparent, sans lissage.</p>',
      action: function (f) {
        var d = A.doc, k = nombre(f, 'echelle');
        telechargerPng(A.agrandir(A.composer(d.iImage), d.w, d.h, k), d.w * k, d.h * k, U.nom + '-' + (d.iImage + 1) + '.png');
      }
    });
  };

  U.dlgPlanche = function () {
    var n = A.doc.images.length;
    U.dialogue({
      titre: 'Exporter la planche de sprites', ok: 'Exporter',
      html: '<p class="rang"><label class="champ">Disposition <select name="forme"><option value="ligne">Une ligne</option><option value="colonne">Une colonne</option><option value="grille">Grille</option></select></label>' +
        champ('Colonnes', 'cols', Math.ceil(Math.sqrt(n)), 1, n) + '</p><p class="rang">' + choixEchelle(1) + '</p>' +
        '<p class="note">' + n + ' image' + (n > 1 ? 's' : '') + ' de ' + A.doc.w + ' × ' + A.doc.h + ' px, rangées de gauche à droite puis de haut en bas. « Colonnes » ne sert qu\'à la grille.</p>',
      action: function (f) {
        var forme = f.elements.forme.value, k = nombre(f, 'echelle');
        var p = A.planche(forme === 'ligne' ? n : forme === 'colonne' ? 1 : entier(f, 'cols', 1, n));
        if (p.w * k > 16384 || p.h * k > 16384) return 'La planche serait trop grande : réduis l\'agrandissement ou choisis une grille.';
        telechargerPng(A.agrandir(p.pix, p.w, p.h, k), p.w * k, p.h * k, U.nom + '-planche.png');
      }
    });
  };

  U.dlgGif = function () {
    var d = A.doc;
    U.dialogue({
      titre: 'Exporter en GIF animé', ok: 'Exporter',
      html: '<p class="rang">' + choixEchelle(echelleConseillee()) + '<label><input type="checkbox" name="boucle" checked> Lecture en boucle</label></p>' +
        '<p class="note">' + d.images.length + ' image' + (d.images.length > 1 ? 's' : '') + ', durées arrondies au centième de seconde (2 au minimum). Le GIF ne connaît ni la demi-transparence ' +
        '(un pixel à moins de 50 % d\'opacité devient transparent, les autres opaques) ni plus de 256 couleurs (au-delà, elles sont réduites).</p>',
      action: function (f) {
        var images = d.images.map(function (im, i) { return { pix: A.composer(i), duree: im.duree }; });
        var octets = A.gifEncoder(images, d.w, d.h, { echelle: nombre(f, 'echelle'), boucle: f.elements.boucle.checked });
        telecharger(new Blob([octets], { type: 'image/gif' }), U.nom + '.gif');
      }
    });
  };

  // ---------- Ouverture et import ----------
  function sansExtension(nom) { return nom.replace(/\.[^.]*$/, '').replace(/[\\/:*?"<>|]/g, '-') || 'sprite'; }

  function ouvrirProjet(fichier) {
    var l = new FileReader();
    l.onload = function () {
      try {
        A.depuisProjet(JSON.parse(l.result));
        U.nom = sansExtension(fichier.name);
        U.rafraichirPalette();
        U.apresChargement();
        U.message('Projet « ' + fichier.name + ' » ouvert.');
      } catch (err) {
        U.alerte('Ouverture impossible', err instanceof SyntaxError ? 'Ce fichier n\'est pas un projet Atelier Pixel lisible.' : err.message);
      }
    };
    l.onerror = function () { U.alerte('Ouverture impossible', 'Le fichier n\'a pas pu être lu.'); };
    l.readAsText(fichier);
  }

  function lireImage(fichier, suite) {
    var l = new FileReader();
    l.onerror = function () { U.alerte('Import impossible', 'Le fichier n\'a pas pu être lu.'); };
    l.onload = function () {
      var img = new Image();
      img.onerror = function () { U.alerte('Import impossible', 'Ce fichier n\'est pas une image reconnue.'); };
      img.onload = function () {
        var c = document.createElement('canvas'), g, w = img.naturalWidth, h = img.naturalHeight;
        if (w > 4096 || h > 4096) { U.alerte('Import impossible', 'L\'image fait ' + w + ' × ' + h + ' px : le maximum est 4096.'); return; }
        c.width = w; c.height = h;
        g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        suite(new Uint32Array(g.getImageData(0, 0, w, h).data.buffer), w, h);
      };
      img.src = l.result;
    };
    l.readAsDataURL(fichier);
  }

  function dlgImport(fichier, pix, w, h) {
    var d = A.doc, cote = (w % d.w === 0 && h % d.h === 0) ? null : (w % h === 0) ? h : Math.min(w, h);
    var lw = cote || d.w, lh = cote || d.h, max = A.TAILLE_MAX;
    U.dialogue({
      titre: 'Importer une image', ok: 'Importer',
      html: '<p>« ' + echapper(fichier.name) + ' » — ' + w + ' × ' + h + ' px</p>' +
        '<p class="pile"><label><input type="radio" name="mode" value="calque" checked> Comme nouveau calque de l\'image en cours</label>' +
        '<label><input type="radio" name="mode" value="sprite"> Comme nouveau sprite</label>' +
        '<label><input type="radio" name="mode" value="planche"> Comme planche de sprites, découpée en images</label></p>' +
        '<p class="rang">' + champ('Largeur d\'une case', 'lw', Math.min(lw, w), 1, Math.min(w, max)) + champ('Hauteur d\'une case', 'lh', Math.min(lh, h), 1, Math.min(h, max)) + '</p>' +
        '<p class="note">Un calque importé est posé en haut à gauche et coupé à la taille de la toile. Les tailles de case ne servent qu\'à la planche ; les cases vides de la fin sont ignorées.</p>',
      action: function (f) {
        var mode = f.elements.mode.value;
        if (mode === 'calque') { A.importerCalque(pix, w, h, sansExtension(fichier.name).slice(0, 40)); return; }
        if (mode === 'sprite') {
          if (!A.docDepuisImage(pix, w, h)) return 'Un sprite ne peut pas dépasser ' + max + ' px de côté.';
        } else if (!A.docDepuisPlanche(pix, w, h, entier(f, 'lw', 1, Math.min(w, max)), entier(f, 'lh', 1, Math.min(h, max)))) {
          return 'Découpe impossible avec ces tailles de case.';
        }
        U.nom = sansExtension(fichier.name);
        U.apresChargement();
      }
    });
  }

  U.choisirProjet = function () { $('#fichierProjet').click(); };
  U.choisirImage = function () { $('#fichierImage').click(); };

  // ---------- Sauvegarde automatique ----------
  var minuterie = null;

  function sauver() {
    var h = new Date();
    minuterie = null;
    try {
      localStorage.setItem(CLE, JSON.stringify(A.versProjet()));
      localStorage.setItem(CLE_NOM, U.nom);
      $('#etatSauve').textContent = 'Sauvegarde auto ' + ('0' + h.getHours()).slice(-2) + ':' + ('0' + h.getMinutes()).slice(-2);
    } catch (err) {
      $('#etatSauve').textContent = 'Sauvegarde auto impossible (stockage plein ou interdit)';
    }
  }

  U.sauverBientot = function () {
    clearTimeout(minuterie);
    minuterie = setTimeout(sauver, DELAI_SAUVE);
  };

  // Reprend le sprite de la dernière séance. Rend faux s'il n'y en a pas ou s'il est illisible.
  U.reprendre = function () {
    try {
      var t = localStorage.getItem(CLE);
      if (!t) return false;
      A.depuisProjet(JSON.parse(t));
      // Les fichiers exportés après un rechargement gardent le nom du sprite.
      U.nom = localStorage.getItem(CLE_NOM) || U.nom;
      return true;
    } catch (err) {
      return false;
    }
  };

  U.initFichiers = function () {
    $('#fichierProjet').addEventListener('change', function () {
      if (this.files[0]) ouvrirProjet(this.files[0]);
      this.value = '';
    });
    $('#fichierImage').addEventListener('change', function () {
      var f = this.files[0];
      if (f) lireImage(f, function (pix, w, h) { dlgImport(f, pix, w, h); });
      this.value = '';
    });
    $('#modal').addEventListener('click', function (e) {
      if (e.target === this || e.target.closest('[data-fermer]')) U.fermer();
    });
    window.addEventListener('pagehide', function () { if (minuterie !== null) { clearTimeout(minuterie); sauver(); } });
  };
})();
