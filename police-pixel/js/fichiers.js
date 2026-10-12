(function () {
  'use strict';

  var PP = window.PP, U = PP.ui;

  var CLE_PROJET = 'police-pixel.projet';
  var CLE_REGLAGES = 'police-pixel.reglages';
  var DELAI_SAUVE = 700;
  var ASCII = (function () { var s = '', i; for (i = 32; i < 127; i++) s += String.fromCharCode(i); return s; })();

  var $ = function (s) { return document.querySelector(s); };
  function echapper(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  U.echapper = echapper;

  // ---------- Fenêtres ----------
  // boutons : [{ nom, fort, action }] ; une action qui rend false ou lève une erreur laisse la fenêtre ouverte.
  U.dialogue = function (o) {
    var m = $('#modal'), boutons = o.boutons || [{ nom: 'Fermer' }];
    m.innerHTML = '<form class="fen' + (o.large ? ' large' : '') + '" novalidate><h2>' + o.titre + '</h2><div class="corps">' + o.html + '</div><p class="erreur" hidden></p><div class="pied">' +
      boutons.map(function (b, i) { return '<button type="' + (b.fort ? 'submit' : 'button') + '" class="btn' + (b.fort ? ' fort' : '') + '" data-i="' + i + '">' + b.nom + '</button>'; }).join('') + '</div></form>';
    m.hidden = false;
    var f = m.firstChild;
    function lancer(b) {
      try {
        if (b.action && b.action(f) === false) return;
        if (!b.garde) U.fermer();
      } catch (e) {
        f.querySelector('.erreur').textContent = e.message;
        f.querySelector('.erreur').hidden = false;
      }
    }
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var fort = boutons.filter(function (b) { return b.fort; })[0];
      if (fort) lancer(fort);
    });
    f.addEventListener('click', function (e) {
      var b = e.target.closest('.pied button');
      if (b && b.type === 'button') lancer(boutons[+b.dataset.i]);
    });
    var premier = f.querySelector('.corps input:not([type=checkbox]), .corps textarea, .corps select') || f.querySelector('.pied .fort') || f.querySelector('.pied button');
    if (premier) { premier.focus(); if (premier.select && premier.type !== 'file') premier.select(); }
    if (o.apres) o.apres(f);
    return f;
  };
  U.fermer = function () { $('#modal').hidden = true; $('#modal').innerHTML = ''; };
  U.fenetreOuverte = function () { return !$('#modal').hidden; };
  $('#modal').addEventListener('mousedown', function (e) { if (e.target === this) U.fermer(); });

  function nombre(f, nom, min, max) {
    var el = f.elements[nom], v = Math.round(Number(el.value));
    if (el.value === '' || !(v >= min && v <= max)) throw new Error('« ' + el.dataset.nom + ' » doit être un nombre entre ' + min + ' et ' + max + '.');
    return v;
  }
  function champ(libelle, nom, valeur, min, max, aide) {
    return '<label class="champ"' + (aide ? ' title="' + echapper(aide) + '"' : '') + '><span>' + libelle + '</span><input type="number" name="' + nom + '" data-nom="' + libelle + '" value="' + valeur + '" min="' + min + '" max="' + max + '" step="1"></label>';
  }
  function texte(libelle, nom, valeur, attributs) {
    return '<label class="champ long"><span>' + libelle + '</span><input type="text" name="' + nom + '" value="' + echapper(valeur) + '" spellcheck="false" autocomplete="off" ' + (attributs || '') + '></label>';
  }
  // Lit des caractères tapés ou des codes (U+0152, 0x152) séparés par des espaces.
  function codesSaisis(s) {
    var r = [];
    s.split(/\s+/).forEach(function (mot) {
      if (/^(U\+|0x)[0-9a-f]{2,6}$/i.test(mot)) r.push(parseInt(mot.slice(2), 16));
      else PP.codes(mot).forEach(function (c) { r.push(c); });
    });
    return r;
  }
  function remplacer(suite) {
    if (U.propre) { suite(); return; }
    U.dialogue({
      titre: 'Remplacer la police en cours ?',
      html: '<p>« ' + echapper(PP.police.nom) + ' » quittera l\'atelier. Enregistrez d\'abord le projet si vous voulez la retrouver.</p>',
      boutons: [{ nom: 'Garder la police en cours' }, { nom: 'Enregistrer puis remplacer', action: function () { U.enregistrer(); setTimeout(suite, 0); } }, { nom: 'Remplacer', fort: true, action: function () { setTimeout(suite, 0); } }]
    });
  }
  function ouvrirPolice(p, message) {
    U.sel = null;
    PP.ouvrir(p);
    U.propre = true;
    U.sauverBientot();
    U.ajuster();
    U.message(message);
  }

  // ---------- Police : création, informations, repères ----------
  function reperes(p) {
    return '<div class="grille">' +
      champ('Hauteur totale', 'h', p.h, PP.H_MIN, PP.H_MAX, 'Nombre de rangées de la grille : c\'est aussi la taille nominale de la police, en pixels.') +
      champ('Ligne de base', 'base', p.base, 2, PP.H_MAX, 'Nombre de rangées au-dessus de la ligne de base (place des accents comprise).') +
      champ('Capitales', 'hcap', p.hcap, 1, PP.H_MAX) + champ('Hauteur d\'x', 'hx', p.hx, 1, PP.H_MAX) +
      champ('Ascendantes', 'hasc', p.hasc, 1, PP.H_MAX) + champ('Descendantes', 'hdesc', p.hdesc, 0, PP.H_MAX) + '</div>' +
      '<p class="note">Les hauteurs se comptent en pixels depuis la ligne de base. Le reste, au-dessus des capitales, sert aux accents ; sous la ligne de base, aux jambages.</p>';
  }
  function lireReperes(f) {
    var o = { h: nombre(f, 'h', PP.H_MIN, PP.H_MAX) };
    o.base = nombre(f, 'base', 2, o.h);
    o.hcap = nombre(f, 'hcap', 1, o.base); o.hx = nombre(f, 'hx', 1, o.base);
    o.hasc = nombre(f, 'hasc', 1, o.base); o.hdesc = nombre(f, 'hdesc', 0, o.h - o.base);
    return o;
  }
  function chasse(p) {
    return '<div class="rang"><label><input type="checkbox" name="fixe"' + (p.fixe ? ' checked' : '') + '> Chasse fixe : tous les caractères ont la même largeur</label>' + champ('de', 'chasse', p.chasse, 1, PP.AV_MAX) + '</div>';
  }

  U.nouveau = function () {
    U.dialogue({
      titre: 'Nouvelle police',
      html: texte('Nom de la famille', 'nom', 'Sans titre') + reperes({ h: 12, base: 10, hcap: 7, hx: 5, hasc: 7, hdesc: 2 }) + chasse({ fixe: false, chasse: 6 }) +
        '<p class="note">La casse s\'ouvre vide, avec tous les caractères du français à dessiner.</p>',
      boutons: [{ nom: 'Annuler' }, {
        nom: 'Créer la police', fort: true, action: function (f) {
          var o = lireReperes(f);
          o.nom = f.elements.nom.value.trim() || 'Sans titre'; o.fixe = f.elements.fixe.checked; o.chasse = nombre(f, 'chasse', 1, PP.AV_MAX);
          setTimeout(function () { remplacer(function () { ouvrirPolice(PP.policeCreer(o), 'Nouvelle police : dessinez le A, puis passez au suivant avec la flèche droite.'); }); }, 0);
        }
      }]
    });
  };

  U.infos = function () {
    var p = PP.police;
    U.dialogue({
      titre: 'Informations et repères',
      html: '<div class="deux"><div class="pile">' + texte('Nom de la famille', 'nom', p.nom) + texte('Style', 'style', p.style, 'list="styles"') +
        '<datalist id="styles"><option value="Normal"><option value="Gras"><option value="Italique"><option value="Gras italique"></datalist>' +
        texte('Auteur', 'auteur', p.auteur) + '<label class="champ long"><span>Licence</span><textarea name="licence" rows="3" spellcheck="false">' + echapper(p.licence) + '</textarea></label>' +
        '<div class="rang"><label><input type="checkbox" name="gras"' + (p.gras ? ' checked' : '') + '> Déclarée grasse</label><label><input type="checkbox" name="italique"' + (p.italique ? ' checked' : '') + '> Déclarée italique</label></div>' +
        '<p class="note">Ces renseignements sont écrits dans le fichier de police : Windows et les logiciels les affichent tels quels.</p></div>' +
        '<div class="pile">' + reperes(p) + chasse(p) + '</div></div>',
      large: true,
      boutons: [{ nom: 'Annuler' }, {
        nom: 'Appliquer', fort: true, action: function (f) {
          var o = lireReperes(f), q = PP.police, change = ['h', 'base', 'hcap', 'hx', 'hasc', 'hdesc'].some(function (c) { return o[c] !== q[c]; }), perdu = 0, k, e;
          var infos = { nom: f.elements.nom.value.trim() || 'Sans titre', style: f.elements.style.value.trim() || 'Normal', auteur: f.elements.auteur.value.trim(), licence: f.elements.licence.value.trim(),
            gras: f.elements.gras.checked, italique: f.elements.italique.checked, fixe: f.elements.fixe.checked, chasse: nombre(f, 'chasse', 1, PP.AV_MAX) };
          if (change) {
            for (k in q.glyphes) { e = q.glyphes[k].pix && PP.boite(q.glyphes[k].pix); if (e && (e.y0 + o.base - q.base < 0 || e.y1 + o.base - q.base >= o.h)) perdu++; }
            PP.reglerMetriques(o);
          }
          PP.reglerPolice(infos);
          U.ajuster();
          if (perdu) U.message(perdu + ' caractères dépassaient de la nouvelle hauteur et ont été rognés. Ctrl+Z pour revenir en arrière.');
        }
      }]
    });
  };

  // ---------- Caractères ----------
  U.ajouter = function () {
    U.dialogue({
      titre: 'Ajouter des caractères',
      html: '<label class="champ long"><span>Caractères ou codes</span><textarea name="cars" rows="3" spellcheck="false" placeholder="ñ ß ¿ ¡   ou   U+2603 U+2190"></textarea></label>' +
        '<p class="note">Tapez ou collez les caractères voulus, ou donnez leurs codes Unicode séparés par des espaces. Ceux que la police contient déjà sont ignorés.</p>',
      boutons: [{ nom: 'Annuler' }, {
        nom: 'Ajouter à la casse', fort: true, action: function (f) {
          var codes = codesSaisis(f.elements.cars.value), n;
          if (!codes.length) throw new Error('Aucun caractère à ajouter.');
          U.deselectionner();
          n = PP.ajouter(codes);
          U.message(n ? n + (n > 1 ? ' caractères ajoutés' : ' caractère ajouté') + ' : ils attendent leur dessin.' : 'Ces caractères étaient déjà dans la police.');
          if (!n) U.rafraichir();
        }
      }]
    });
  };

  U.dupliquerVers = function () {
    var code = PP.police.courant;
    U.dialogue({
      titre: 'Dupliquer « ' + echapper(PP.car(code)) + ' »',
      html: texte('Vers le caractère', 'cible', '', 'maxlength="8" placeholder="un caractère ou un code U+…"') +
        '<p class="note">Le dessin et la chasse sont recopiés ; le caractère d\'arrivée est créé s\'il manque, remplacé s\'il existe.</p>',
      boutons: [{ nom: 'Annuler' }, {
        nom: 'Dupliquer', fort: true, action: function (f) {
          var c = codesSaisis(f.elements.cible.value)[0];
          if (c === undefined || c < 0x20) throw new Error('Indiquez le caractère d\'arrivée.');
          if (c === code) throw new Error('C\'est le même caractère.');
          if (PP.dependants(c).length) throw new Error('« ' + PP.car(c) + ' » sert de base ou d\'accent à d\'autres caractères : il serait dangereux de l\'écraser.');
          U.deselectionner();
          PP.dupliquer(code, c);
        }
      }]
    });
  };

  U.composer = function () {
    var code = PP.police.courant, d = PP.decomposition(code) || { base: 0, accent: 0 };
    if (d.base === 0x131 && !PP.glyphe(0x131)) d.base = 0x69;
    U.dialogue({
      titre: 'Composer « ' + echapper(PP.car(code)) + ' »',
      html: '<div class="rang">' + texte('Lettre de base', 'base', d.base ? PP.car(d.base) : '', 'maxlength="8"') + texte('Accent', 'accent', d.accent ? PP.car(d.accent) : '', 'maxlength="8"') + '</div>' +
        '<p class="note">Le caractère devient la réunion des deux dessins et suit leurs retouches. L\'accent se centre tout seul et monte au-dessus des capitales ; Maj+flèches l\'ajuste ensuite, « Détacher » le rend indépendant. ' +
        'Pour î et ï, la base est le i sans point (ı).</p>',
      boutons: [{ nom: 'Annuler' }, {
        nom: 'Composer', fort: true, action: function (f) {
          var b = codesSaisis(f.elements.base.value)[0], a = codesSaisis(f.elements.accent.value)[0], r;
          if (b === undefined || a === undefined) throw new Error('Indiquez la lettre de base et l\'accent.');
          U.deselectionner();
          r = PP.lier(code, b, a);
          if (r) throw new Error(r);
        }
      }]
    });
  };

  U.italique = function () {
    if (PP.police.pas) { U.message('Cette police est déjà penchée.'); return; }
    U.dialogue({
      titre: 'Variante italique',
      html: '<label class="champ"><span>Un pixel de décalage toutes les</span><select name="pas"><option value="2">2 rangées (très penché)</option><option value="3" selected>3 rangées</option><option value="4">4 rangées</option><option value="5">5 rangées (à peine)</option></select></label>' +
        '<p class="note">Chaque dessin est cisaillé en escalier autour de la ligne de base. La police en cours est transformée : enregistrez d\'abord le projet du romain si vous voulez garder les deux.</p>',
      boutons: [{ nom: 'Annuler' }, { nom: 'Pencher la police', fort: true, action: function (f) { U.deselectionner(); PP.deriverItalique(+f.elements.pas.value); U.message('Police penchée. Ctrl+Z pour revenir au romain.'); } }]
    });
  };

  // ---------- Téléchargements ----------
  function telecharger(nom, donnees, type) {
    var a = document.createElement('a'), url = URL.createObjectURL(new Blob([donnees], { type: type }));
    a.href = url; a.download = nom;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  U.telecharger = telecharger;
  function octets(n) { return n.toLocaleString('fr-FR') + ' octets'; }
  function pret() {
    var n = PP.ordre().filter(PP.utilisable).filter(function (c) { return !PP.estBlanc(c); }).length;
    if (!n) U.message('Rien à exporter : aucun caractère n\'est dessiné.');
    return n;
  }
  function manque() {
    var n = PP.ordre().filter(PP.aDessiner).length;
    return n ? ' ' + n + ' caractères restent à dessiner et n\'y figurent pas.' : '';
  }

  U.exporter = function (quoi) {
    var f = PP.nomFichier(), ttf, pl, n;
    U.deselectionner();
    if (!(n = pret())) return;
    if (quoi === 'ttf' || quoi === 'woff') {
      ttf = PP.ttf();
      if (quoi === 'woff') ttf = PP.woff(ttf);
      telecharger(f + '.' + quoi, ttf, quoi === 'ttf' ? 'font/ttf' : 'font/woff');
      U.message(f + '.' + quoi + ' exporté : ' + n + ' caractères, ' + octets(ttf.length) + '.' + manque());
    } else if (quoi === 'planche') {
      pl = PP.planche({ mode: 'serree' });
      telecharger(f + '.png', PP.png(pl.l, pl.h, pl.masque), 'image/png');
      telecharger(f + '.json', JSON.stringify(PP.plancheJSON(pl, f + '.png'), null, 1), 'application/json');
      U.message(f + '.png (' + pl.l + ' × ' + pl.h + ', encre blanche sur fond transparent) et ' + f + '.json exportés.' + manque());
    } else if (quoi === 'bmfont') {
      pl = PP.planche({ mode: 'serree' });
      telecharger(f + '-bmfont.png', PP.png(pl.l, pl.h, pl.masque), 'image/png');
      telecharger(f + '.fnt', PP.bmfont(pl, f + '-bmfont.png'), 'text/plain');
      U.message(f + '.fnt et ' + f + '-bmfont.png exportés au format BMFont.' + manque());
    } else if (quoi === 'grille') {
      pl = PP.planche({ mode: 'grille' });
      telecharger(f + '-grille.png', PP.png(pl.l, pl.h, pl.masque, [0, 0, 0], [255, 255, 255]), 'image/png');
      U.message(f + '-grille.png exporté : cases de ' + pl.grille.cl + ' × ' + pl.grille.ch + ', 16 par rangée, par code croissant.');
    } else if (quoi === 'css') {
      U.dialogue({
        titre: 'Extrait CSS',
        html: '<textarea class="code" rows="15" readonly spellcheck="false">' + echapper(PP.css()) + '</textarea>' +
          '<p class="note">Exportez la police en .ttf et en .woff, placez les deux fichiers à côté de la feuille de style, puis collez cet extrait.</p>',
        boutons: [{ nom: 'Fermer' }, { nom: 'Télécharger ' + f + '.css', action: function () { telecharger(f + '.css', PP.css(), 'text/css'); }, garde: true }, {
          nom: 'Copier', fort: true, garde: true, action: function (fen) {
            var t = fen.querySelector('textarea');
            t.select();
            try { document.execCommand('copy'); U.message('Extrait CSS copié.'); } catch (e) { U.message('Copie impossible : sélectionnez le texte et copiez-le à la main.'); }
          }
        }]
      });
    }
  };

  // ---------- Projet ----------
  U.enregistrer = function () {
    U.deselectionner();
    telecharger(PP.nomFichier() + '.police.json', JSON.stringify(PP.versJSON()), 'application/json');
    U.message('Projet enregistré : ' + PP.nomFichier() + '.police.json');
  };
  U.ouvrirProjet = function () { $('#fichierProjet').value = ''; $('#fichierProjet').click(); };
  U.demo = function (i) {
    remplacer(function () { ouvrirPolice(PP.demo(i), PP.demos[i].nom + ' : ' + PP.demos[i].note + '.'); });
  };

  function sauver() {
    try {
      localStorage.setItem(CLE_PROJET, JSON.stringify(PP.versJSON()));
      $('#etatSauve').textContent = 'Sauvegardé dans ce navigateur';
    } catch (e) {
      $('#etatSauve').textContent = 'Sauvegarde automatique impossible : enregistrez le projet';
    }
  }
  U.sauverBientot = function () {
    clearTimeout(sauver.t);
    $('#etatSauve').textContent = '';
    sauver.t = setTimeout(sauver, DELAI_SAUVE);
  };
  U.restaurer = function () {
    try {
      var s = localStorage.getItem(CLE_PROJET);
      return s ? PP.depuisJSON(JSON.parse(s)) : null;
    } catch (e) { return null; }
  };
  U.surReglage = function () {
    var E = U.epreuveEtat;
    try { localStorage.setItem(CLE_REGLAGES, JSON.stringify({ texte: E.texte, taille: E.taille, sombre: E.sombre })); } catch (e) { /* stockage indisponible */ }
  };
  U.lireReglages = function () {
    var E = U.epreuveEtat, o;
    try { o = JSON.parse(localStorage.getItem(CLE_REGLAGES) || 'null'); } catch (e) { o = null; }
    if (!o) return;
    if (typeof o.texte === 'string') E.texte = o.texte.slice(0, 5000);
    if (o.taille >= 1 && o.taille <= 4) E.taille = Math.round(o.taille);
    E.sombre = !!o.sombre;
  };

  // ---------- Import d'une planche ----------
  function importer(image, nom) {
    var c = document.createElement('canvas'), g, donnees, cl, ch;
    c.width = image.naturalWidth; c.height = image.naturalHeight;
    if (c.width > 4096 || c.height > 4096) { U.message('Image trop grande : 4096 pixels de côté au plus.'); return; }
    g = c.getContext('2d'); g.drawImage(image, 0, 0);
    donnees = g.getImageData(0, 0, c.width, c.height);
    cl = PP.borne(Math.round(c.width / 16), 2, 64);
    ch = PP.borne(Math.round(c.height / Math.max(1, Math.round(c.height / (cl * 1.6)))), PP.H_MIN, PP.H_MAX);
    U.dialogue({
      titre: 'Importer une planche de caractères',
      large: true,
      html: '<div class="deux"><div class="pile">' +
        '<div class="grille">' + champ('Largeur d\'une case', 'cl', cl, 2, 64) + champ('Hauteur d\'une case', 'ch', ch, PP.H_MIN, PP.H_MAX) +
        champ('Marge à gauche', 'ox', 0, 0, 4096) + champ('Marge en haut', 'oy', 0, 0, 4096) +
        champ('Écart horizontal', 'ex', 0, 0, 64) + champ('Écart vertical', 'ey', 0, 0, 64) +
        champ('Ligne de base', 'base', Math.round(ch * 0.8), 1, PP.H_MAX, 'Nombre de rangées de la case au-dessus de la ligne de base : le trait rouge de l\'aperçu.') + champ('Approche droite', 'approche', 1, 0, 8) + '</div>' +
        '<label class="champ long"><span>Largeurs</span><select name="largeurs"><option value="detecter">Détecter d\'après l\'encre (proportionnelle)</option><option value="case">Garder le dessin en place, chasse d\'une case</option><option value="fixe">Chasse fixe d\'une case</option></select></label>' +
        '<label class="champ long"><span>Caractères, dans l\'ordre de lecture de la planche</span><textarea name="cars" rows="3" spellcheck="false">' + echapper(ASCII) + '</textarea></label>' +
        '<p class="note">La couleur du coin en haut à gauche est prise pour le fond ; tout ce qui s\'en écarte nettement est de l\'encre. L\'image doit être à l\'échelle 1, un pixel par pixel.</p></div>' +
        '<div class="apercu-planche"><canvas></canvas></div></div>',
      boutons: [{ nom: 'Annuler' }, {
        nom: 'Créer une police avec cette planche', fort: true, action: function (f) {
          var o = lire(f), p;
          o.codes = PP.codes(f.elements.cars.value.replace(/[\r\n]/g, ''));
          o.nom = nom.replace(/\.[a-z0-9]+$/i, '') || 'Planche importée';
          p = PP.importerPlanche(donnees.data, c.width, c.height, o);
          setTimeout(function () { remplacer(function () { ouvrirPolice(p, 'Planche importée : ' + PP.ordre().length + ' caractères. Vérifiez les repères dans Police > Informations et repères.'); }); }, 0);
        }
      }],
      apres: function (f) {
        var vue = f.querySelector('.apercu-planche canvas'), e = Math.max(1, Math.min(4, Math.floor(420 / c.width)));
        function tracer() {
          var o, v = vue.getContext('2d'), x, y, n = 0, nb = PP.codes(f.elements.cars.value.replace(/[\r\n]/g, '')).length;
          try { o = lire(f); } catch (err) { return; }
          vue.width = c.width * e; vue.height = c.height * e;
          v.imageSmoothingEnabled = false;
          v.fillStyle = '#8d919b'; v.fillRect(0, 0, vue.width, vue.height);
          v.drawImage(c, 0, 0, vue.width, vue.height);
          for (y = o.oy; y + o.ch <= c.height; y += o.ch + o.ey) {
            for (x = o.ox; x + o.cl <= c.width; x += o.cl + o.ex) {
              if (n++ >= nb) break;
              v.strokeStyle = 'rgba(61, 143, 209, .9)'; v.lineWidth = 1;
              v.strokeRect(x * e + 0.5, y * e + 0.5, o.cl * e - 1, o.ch * e - 1);
              v.fillStyle = 'rgba(217, 81, 60, .9)';
              v.fillRect(x * e, (y + o.base) * e, o.cl * e, 1);
            }
          }
        }
        f.addEventListener('input', tracer);
        tracer();
      }
    });
    function lire(f) {
      var o = { cl: nombre(f, 'cl', 2, 64), ch: nombre(f, 'ch', PP.H_MIN, PP.H_MAX), ox: nombre(f, 'ox', 0, 4096), oy: nombre(f, 'oy', 0, 4096), ex: nombre(f, 'ex', 0, 64), ey: nombre(f, 'ey', 0, 64), approche: nombre(f, 'approche', 0, 8), largeurs: f.elements.largeurs.value };
      o.base = nombre(f, 'base', 1, o.ch);
      return o;
    }
  }
  U.importerPlanche = function () { $('#fichierImage').value = ''; $('#fichierImage').click(); };

  U.initFichiers = function () {
    $('#fichierProjet').addEventListener('change', function () {
      var fichier = this.files[0], lecteur = new FileReader();
      if (!fichier) return;
      lecteur.onload = function () {
        var p;
        try { p = PP.depuisJSON(JSON.parse(lecteur.result)); } catch (e) { U.dialogue({ titre: 'Projet illisible', html: '<p>' + echapper(e.message) + '</p>' }); return; }
        remplacer(function () { ouvrirPolice(p, 'Projet ouvert : ' + p.nom + '.'); });
      };
      lecteur.readAsText(fichier);
    });
    $('#fichierImage').addEventListener('change', function () {
      var fichier = this.files[0], image = new Image(), url;
      if (!fichier) return;
      url = URL.createObjectURL(fichier);
      image.onload = function () { URL.revokeObjectURL(url); importer(image, fichier.name); };
      image.onerror = function () { URL.revokeObjectURL(url); U.dialogue({ titre: 'Image illisible', html: '<p>Ce fichier n\'est pas une image que le navigateur sait lire (PNG, GIF, JPEG, WebP ou BMP).</p>' }); };
      image.src = url;
    });
  };
})();
