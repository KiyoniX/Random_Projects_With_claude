(function () {
  'use strict';

  var P = window.PlanVille, Monde = window.VisiteMonde, Marche = window.VisiteMarche, Rendu = window.VisiteRendu;
  var PAS = 4.3, COURSE = 8.6;            // vitesses à pied, en mètres par seconde
  var VOL = 26, VOL_VITE = 80;            // vitesses en survol
  var CHAMP = 1.15;                       // champ vertical, en radians
  var SOURIS = 0.0022, DOIGT = 0.006;     // radians par pixel de souris, de doigt
  var PLAN_PX = 1600;                     // côté du plan une fois tramé
  var MINI_RAYON = 60;                    // mètres montrés de part et d'autre sur le plan de poche
  var PALIERS = ['basse', 'moyenne', 'haute'];

  var $ = function (s) { return document.querySelector(s); };
  var toile = $('#vue'), rendu = null, monde = null, marche = null, ville = null, adresse = '', graine = '', taille = 'ville';
  var w = null;                                             // le marcheur : { x, y, z, vz, auSol }
  var cap = 0, tangage = 0, survol = false, vol = { x: 0, y: 0, h: 40 }, vx = 0, vy = 0, chemin = 0;
  var touches = {}, elan = false, actif = false, capture = false, pret = false;
  var heure = 9.5, heureVisee = 9.5, temps = 0;
  var choix = 'auto', palier = 'moyenne', mesure = { n: 0, somme: 0, saute: 12, monte: false, fige: false };
  var plan = null, vus = {}, quartier = '', quartierVu = 0, acces = null, stats = { appels: 0, triangles: 0, ms: 0 };
  var pouces = { g: null, d: null }, glisse = null, dernier = 0, lisse = 16, cadence = false;

  // ---------- Adresse ----------
  function lireAdresse() {
    var a = P.parse(location.hash.slice(1)), de;
    graine = a.seed || Math.random().toString(36).slice(2, 8);
    taille = a.size;
    de = a.from && a.from.seed === graine ? a.from : null;
    adresse = encodeURIComponent(graine) + '/' + taille + (de ? '?' + de.query : '');
    try { history.replaceState(null, '', '#' + adresse); } catch (e) { location.replace('#' + adresse); }   // Chrome refuse replaceState en file://
    return de;
  }
  window.addEventListener('hashchange', function () {
    if (location.hash.slice(1) !== adresse) location.reload();
  });

  function memoire(cle, valeur) {
    try {
      if (valeur === undefined) return localStorage.getItem(cle);
      localStorage.setItem(cle, valeur);
    } catch (e) { /* stockage refusé : on s'en passe */ }
    return null;
  }

  // ---------- Chantier ----------
  function dire(texte) { $('#chantier').textContent = texte; }
  function panne(texte) {
    $('#chantier').className = 'note panne';
    $('#chantier').textContent = texte;
    $('#entree').hidden = true;
    $('#seuil').classList.add('chantier');
  }

  function demarrer() {
    var de = lireAdresse(), retour = '../plans-de-ville/index.html#' + adresse, ch, i = 0, t0 = performance.now(), t1;
    $('#versPlan').href = retour; $('#seuilPlan').href = retour;
    $('#seuil').classList.add('chantier');
    rendu = Rendu.creer(toile);
    if (!rendu) { panne('Ce navigateur n\'offre pas WebGL 2, dont la visite a besoin pour dresser la ville en volumes. Le plan, lui, reste consultable.'); nommer(P.plan(graine, taille, de)); return; }
    if (rendu.panne) { panne('La carte graphique a refusé les nuanceurs de la visite (' + rendu.panne.slice(0, 160) + '). Le plan, lui, reste consultable.'); nommer(P.plan(graine, taille, de)); return; }
    ville = P.plan(graine, taille, de);
    nommer(ville);
    ch = Monde.creer(ville);
    // Une étape par image, pour que le feuillet dise où en est le chantier au lieu de figer la page.
    function suite() {
      var e = ch.etapes[i++];
      if (e) { dire(e[0] + '…'); setTimeout(function () { e[1](); suite(); }, 16); return; }
      monde = ch.monde;
      t1 = performance.now();
      rendu.charge(monde);
      marche = Marche.creer(monde.collision);
      window.Visite.chantier = { monde: Math.round(t1 - t0), rendu: Math.round(performance.now() - t1) };
      ouvrir();
    }
    dire('On déroule le plan…');
    setTimeout(suite, 30);
  }

  function nommer(v) {
    var genre = v.size + (v.people ? ' des ' + v.people : '');
    $('#ville').textContent = v.name; $('#seuilVille').textContent = v.name;
    $('#genre').textContent = genre; $('#seuilGenre').textContent = genre;
    document.title = 'Visite de ' + v.name;
  }

  function ouvrir() {
    var d = marche.pose(monde.depart.x, monde.depart.y), q = memoire('visite-qualite'), vu;
    w = marche.nouveau(d.x, d.y);
    cap = monde.depart.cap; tangage = 0.04;
    if (PALIERS.indexOf(q) >= 0) { choix = palier = q; }
    try { vu = JSON.parse(memoire('visite-carnet:' + adresse) || '{}'); } catch (e) { vu = {}; }
    monde.lieux.forEach(function (l) { if (vu[l.id]) vus[l.id] = true; });
    tramerPlan();
    carnet();
    reglages();
    pret = true;
    $('#seuil').classList.remove('chantier');
    $('#chantier').hidden = true;
    $('#entree').hidden = false;
    if (innerWidth < 740 || innerHeight < 480) $('#billet').open = false;
    if (matchMedia('(pointer: coarse)').matches) $('#consignes').textContent = 'Pouce gauche pour marcher, pouce droit pour regarder. Touche le plan de poche pour le déplier, le carnet pour voir ce qu\'il reste à trouver.';
    dernier = performance.now();
    requestAnimationFrame(image);
  }

  // ---------- Entrée et sortie ----------
  function entrer(sansCapture) {
    var p;
    if (!pret) return;
    $('#seuil').hidden = true;
    fermerCarte();
    actif = true;
    toile.focus();
    if (sansCapture || !toile.requestPointerLock || matchMedia('(pointer: coarse)').matches) return;
    try {
      p = toile.requestPointerLock();
      if (p && p.catch) p.catch(function () { /* capture refusée : on regarde en glissant */ });
    } catch (e) { /* idem */ }
  }
  function sortir() {
    actif = false; touches = {};
    document.body.classList.remove('en-marche');
    $('#seuilAvant').textContent = 'Halte dans';
    $('#entrer').firstChild.textContent = 'Reprendre';
    $('#entrer').querySelector('small').textContent = 'la visite';
    $('#seuil').hidden = false;
  }
  document.addEventListener('pointerlockchange', function () {
    capture = document.pointerLockElement === toile;
    document.body.classList.toggle('en-marche', capture);
    if (!capture && actif && $('#carte').hidden) sortir();
  });
  $('#entrer').addEventListener('click', function () { entrer(false); });
  toile.addEventListener('click', function () { if (pret && actif && !capture && !matchMedia('(pointer: coarse)').matches && toile.requestPointerLock) entrer(false); });

  // ---------- Clavier ----------
  // Les déplacements se lisent sur la position des touches (code) : ZQSD sur un clavier français, WASD ailleurs, sans réglage.
  var CODES = { KeyW: 'avant', ArrowUp: 'avant', KeyS: 'arriere', ArrowDown: 'arriere', KeyA: 'gauche', ArrowLeft: 'gauche', KeyD: 'droite', ArrowRight: 'droite', ShiftLeft: 'vite', ShiftRight: 'vite', Space: 'saut', KeyX: 'bas' };
  var LETTRES = { z: 'avant', w: 'avant', s: 'arriere', q: 'gauche', a: 'gauche', d: 'droite', arrowup: 'avant', arrowdown: 'arriere', arrowleft: 'gauche', arrowright: 'droite', shift: 'vite', ' ': 'saut', x: 'bas' };
  function ordre(e) { return e.code ? CODES[e.code] : LETTRES[(e.key || '').toLowerCase()]; }

  document.addEventListener('keydown', function (e) {
    var o = ordre(e), k = (e.key || '').toLowerCase(), tag = e.target && e.target.tagName;
    if (!pret || e.altKey || e.metaKey) return;
    if (tag === 'INPUT' && e.target.type !== 'range') return;
    if (k === 'escape') {
      if (!$('#carte').hidden) { fermerCarte(); e.preventDefault(); }
      else if (actif && !capture) sortir();
      return;
    }
    if (k === 'enter' && !actif && $('#carte').hidden) { entrer(false); e.preventDefault(); return; }
    if (o && actif && !e.ctrlKey) { touches[o] = true; if (o === 'saut') elan = true; e.preventDefault(); return; }
    if (e.ctrlKey || e.repeat) return;
    if (k === 'm') basculerCarte();
    else if (k === 'c') deplierCarnet();
    else if (k === 'v') basculerSurvol();
    else if (k === 'p') garderImage();
    else if (k === 'e') emprunter();
    else if (k === 'i') { cadence = !cadence; $('#cadence').hidden = !cadence; }
    else if (k === 't') viserHeure((heureVisee + 1.5) % 24);
    else return;
    e.preventDefault();
  });
  document.addEventListener('keyup', function (e) { var o = ordre(e); if (o) touches[o] = false; });
  window.addEventListener('blur', function () { touches = {}; });

  // ---------- Souris et doigts ----------
  function tourner(dx, dy, k) {
    cap += dx * k;
    tangage = Math.max(-1.5, Math.min(1.5, tangage - dy * k));
  }
  document.addEventListener('mousemove', function (e) {
    if (capture && actif) tourner(e.movementX || 0, e.movementY || 0, SOURIS);
  });
  // Sans capture du pointeur (refusée, ou écran tactile) : on regarde en glissant, et sur tactile le pouce gauche marche.
  toile.addEventListener('pointerdown', function (e) {
    var gauche;
    if (!actif || capture) return;
    if (e.pointerType === 'touch') {
      gauche = e.clientX < innerWidth / 2;
      if (pouces[gauche ? 'g' : 'd']) return;
      pouces[gauche ? 'g' : 'd'] = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      marquePouce(gauche ? 'g' : 'd');
    } else glisse = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { toile.setPointerCapture(e.pointerId); } catch (err) { /* pointeur déjà relâché */ }
    e.preventDefault();
  });
  toile.addEventListener('pointermove', function (e) {
    var p = pouces.g && pouces.g.id === e.pointerId ? pouces.g : pouces.d && pouces.d.id === e.pointerId ? pouces.d : null;
    if (p) {
      if (p === pouces.d) tourner(e.clientX - p.x, e.clientY - p.y, DOIGT);
      p.x = e.clientX; p.y = e.clientY;
      marquePouce(p === pouces.g ? 'g' : 'd');
    } else if (glisse && glisse.id === e.pointerId) {
      tourner(e.clientX - glisse.x, e.clientY - glisse.y, SOURIS * 1.6);
      glisse.x = e.clientX; glisse.y = e.clientY;
    }
  });
  function lache(e) {
    if (pouces.g && pouces.g.id === e.pointerId) { pouces.g = null; marquePouce('g'); }
    if (pouces.d && pouces.d.id === e.pointerId) { pouces.d = null; marquePouce('d'); }
    if (glisse && glisse.id === e.pointerId) glisse = null;
  }
  toile.addEventListener('pointerup', lache);
  toile.addEventListener('pointercancel', lache);
  function marquePouce(c) {
    var el = $(c === 'g' ? '#pouceG' : '#pouceD'), p = pouces[c], dx, dy, l;
    el.hidden = !p;
    if (!p) return;
    dx = c === 'g' ? p.x - p.x0 : 0; dy = c === 'g' ? p.y - p.y0 : 0; l = Math.max(1, Math.sqrt(dx * dx + dy * dy) / 44);
    el.style.left = (c === 'g' ? p.x0 : p.x) + 'px'; el.style.top = (c === 'g' ? p.y0 : p.y) + 'px';
    el.style.setProperty('--dx', dx / l + 'px'); el.style.setProperty('--dy', dy / l + 'px');
  }

  // ---------- Déplacement ----------
  function avancer(dt) {
    var av = (touches.avant ? 1 : 0) - (touches.arriere ? 1 : 0), cote = (touches.droite ? 1 : 0) - (touches.gauche ? 1 : 0), l, v, cx, cy, tx, ty, k, ox, oy, sol, mh, cp;
    if (pouces.g) { cote += Math.max(-1, Math.min(1, (pouces.g.x - pouces.g.x0) / 50)); av -= Math.max(-1, Math.min(1, (pouces.g.y - pouces.g.y0) / 50)); }
    if (!actif || !$('#carte').hidden) av = cote = 0;
    l = Math.sqrt(av * av + cote * cote);
    if (l > 1) { av /= l; cote /= l; }
    cx = Math.cos(cap); cy = Math.sin(cap);
    if (survol) {
      v = touches.vite ? VOL_VITE : VOL; cp = Math.cos(tangage);
      vol.x += (cx * cp * av - cy * cote) * v * dt; vol.y += (cy * cp * av + cx * cote) * v * dt;
      vol.h += (Math.sin(tangage) * av + ((touches.saut ? 1 : 0) - (touches.bas ? 1 : 0)) * 0.7) * v * dt;
      l = Math.sqrt(vol.x * vol.x + vol.y * vol.y); mh = monde.E * 1.25;
      if (l > mh) { vol.x *= mh / l; vol.y *= mh / l; }
      sol = monde.collision.zsol(vol.x, vol.y);
      vol.h = Math.max(sol + 2.5, Math.min(450, vol.h));
      return;
    }
    v = touches.vite ? COURSE : PAS;
    tx = (cx * av - cy * cote) * v; ty = (cy * av + cx * cote) * v;
    k = Math.min(1, dt * (w.auSol ? 11 : 2.5));
    vx += (tx - vx) * k; vy += (ty - vy) * k;
    ox = w.x; oy = w.y;
    // Un appui bref compte même s'il est relâché avant l'image suivante.
    marche.pas(w, vx * dt, vy * dt, dt, actif && (touches.saut || elan) && $('#carte').hidden);
    elan = false;
    if (w.auSol) chemin += Math.sqrt((w.x - ox) * (w.x - ox) + (w.y - oy) * (w.y - oy));
    // Contre un mur, la vitesse retenue est celle qu'on a vraiment eue : on repart sans à-coup.
    if (dt > 0) { vx += ((w.x - ox) / dt - vx) * 0.5; vy += ((w.y - oy) / dt - vy) * 0.5; }
  }

  function basculerSurvol() {
    var p;
    if (!pret) return;
    if (!survol) {
      vol.x = w.x - Math.cos(cap) * 18; vol.y = w.y - Math.sin(cap) * 18; vol.h = w.z + 34; tangage = -0.5; survol = true;
    } else {
      p = marche.pose(Math.max(-monde.collision.limite, Math.min(monde.collision.limite, vol.x)), Math.max(-monde.collision.limite, Math.min(monde.collision.limite, vol.y)));
      w = marche.nouveau(p.x, p.y); vx = vy = 0; tangage = 0; survol = false;
    }
    $('#survol').textContent = survol ? 'Redescendre à pied' : 'Prendre de la hauteur';
    annoncer(survol ? 'À vol d\'oiseau' : '', survol ? 'Espace pour monter, X pour descendre' : '');
  }

  function porter(x, y, z, versCap) {
    $('#fondu').classList.add('noir');
    setTimeout(function () {
      var p = z ? { x: x, y: y } : marche.pose(x, y);
      survol = false; $('#survol').textContent = 'Prendre de la hauteur';
      w = marche.nouveau(p.x, p.y);
      if (z) { w.z = z; w.z = marche.sol(p.x, p.y, z + 0.2); }
      vx = vy = 0;
      if (versCap !== undefined) cap = versCap;
      tangage = 0;
      $('#fondu').classList.remove('noir');
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 230);
  }

  // ---------- Quartiers, lieux, passages ----------
  function annoncer(nom, sous) {
    var el = $('#quartier');
    if (!nom) { el.classList.remove('vu'); return; }
    el.textContent = nom;
    if (sous) { var s = document.createElement('small'); s.textContent = sous; el.appendChild(s); }
    el.classList.add('vu');
    quartierVu = performance.now();
  }

  function reperer(maintenant) {
    var q, x = survol ? vol.x : w.x, y = survol ? vol.y : w.y, pres = null, d;
    if (!survol) {
      q = w.z > Monde.MUR_H + 5 ? 'Sommet du donjon' : w.z > Monde.MUR_H - 0.6 && w.auSol ? 'Chemin de ronde' : monde.quartier(x, y);
      if (q && q !== quartier) { quartier = q; annoncer(q); }
      monde.lieux.forEach(function (l) {
        if (vus[l.id]) return;
        if (l.ronde ? w.auSol && w.z >= l.haut && w.z < l.haut + 3 : Math.sqrt((l.x - x) * (l.x - x) + (l.y - y) * (l.y - y)) < l.r && (l.haut ? w.z >= l.haut : w.z < 5)) trouver(l);
      });
      monde.acces.forEach(function (a) {
        d = Math.sqrt((a.x - x) * (a.x - x) + (a.y - y) * (a.y - y));
        if (d < a.r && Math.abs(a.z - w.z) < 1.5) pres = a;
      });
    }
    if (pres !== acces) {
      acces = pres;
      $('#invite').innerHTML = pres ? '<kbd>E</kbd>' : '';
      if (pres) $('#invite').appendChild(document.createTextNode(pres.texte));
    }
    if (maintenant - quartierVu > 3200) $('#quartier').classList.remove('vu');
  }
  function emprunter() { if (acces && actif) porter(acces.vers.x, acces.vers.y, acces.vers.z || 0.001, acces.vers.cap); }
  $('#invite').addEventListener('click', emprunter);

  function trouver(l) {
    var note = {};
    vus[l.id] = true;
    Object.keys(vus).forEach(function (k) { note[k] = 1; });
    memoire('visite-carnet:' + adresse, JSON.stringify(note));
    carnet();
    annoncer(l.nom, 'noté au carnet');
    $('#carnet').classList.remove('neuf');
    void $('#carnet').offsetWidth;
    $('#carnet').classList.add('neuf');
  }

  function carnet() {
    var ol = $('#lieux'), n = 0;
    ol.textContent = '';
    monde.lieux.forEach(function (l) {
      var li = document.createElement('li'), a;
      if (vus[l.id]) {
        n++; li.className = 'vu'; li.textContent = l.nom;
        if (l.catacombes) {
          a = document.createElement('a');
          a.href = '../cartes-et-cachots/index.html#' + encodeURIComponent(graine + '-' + taille) + '?' + new URLSearchParams({ ville: ville.name, plan: adresse });
          a.textContent = 'y descendre';
          li.appendChild(document.createTextNode(' : ')); li.appendChild(a);
        }
      } else li.textContent = l.texte;
      ol.appendChild(li);
    });
    $('#compte').textContent = n === monde.lieux.length ? 'tout est vu' : n + ' sur ' + monde.lieux.length;
  }
  function deplierCarnet() {
    var ol = $('#lieux');
    ol.hidden = !ol.hidden;
    $('#carnetTitre').setAttribute('aria-expanded', String(!ol.hidden));
  }
  $('#carnetTitre').addEventListener('click', function (e) { deplierCarnet(); if (e.detail) e.currentTarget.blur(); });

  // ---------- Plan ----------
  // Le plan de poche et le plan déplié sont la planche d'origine : le SVG du plan, tramé une fois dans une toile.
  function tramerPlan() {
    var img = new Image(), url = URL.createObjectURL(new Blob([ville.svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = function () {
      var c = document.createElement('canvas');
      c.width = c.height = PLAN_PX;
      c.getContext('2d').drawImage(img, 0, 0, PLAN_PX, PLAN_PX);
      URL.revokeObjectURL(url);
      plan = c;
    };
    img.src = url;
  }
  // Mètres du monde → pixels de la planche (côté 1000).
  function surPlan(v) { return v / monde.S * ville.model.k + ville.model.px / 2; }
  function fleche(ctx, px, py, r) {
    ctx.save();
    ctx.translate(px, py); ctx.rotate(cap + Math.PI / 2);
    ctx.beginPath(); ctx.moveTo(0, -r * 4.5); ctx.lineTo(r * 3.2, -r * 9); ctx.arc(0, 0, r * 9.5, -Math.PI / 2 + 0.34, -Math.PI / 2 - 0.34, true); ctx.closePath();
    ctx.fillStyle = 'rgba(179,52,31,.16)'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -r * 1.9); ctx.lineTo(r * 1.15, r * 1.3); ctx.lineTo(0, r * 0.6); ctx.lineTo(-r * 1.15, r * 1.3); ctx.closePath();
    ctx.fillStyle = '#b3341f'; ctx.strokeStyle = '#f1e5c6'; ctx.lineWidth = r * 0.34; ctx.lineJoin = 'round';
    ctx.stroke(); ctx.fill();
    ctx.restore();
  }
  function dessinerMini() {
    var c = $('#miniToile'), ctx = c.getContext('2d'), k = PLAN_PX / ville.model.px, x = survol ? vol.x : w.x, y = survol ? vol.y : w.y;
    var r = MINI_RAYON / monde.S * ville.model.k * k * (survol ? 2.2 : 1), sx = surPlan(x) * k, sy = surPlan(y) * k;
    ctx.fillStyle = '#e4d2aa'; ctx.fillRect(0, 0, c.width, c.height);
    if (plan) ctx.drawImage(plan, sx - r, sy - r, r * 2, r * 2, 0, 0, c.width, c.height);
    fleche(ctx, c.width / 2, c.height / 2, 9);
  }
  function dessinerCarte() {
    var c = $('#carteToile'), ctx = c.getContext('2d'), k = c.width / ville.model.px, x = survol ? vol.x : w.x, y = survol ? vol.y : w.y;
    ctx.fillStyle = '#e4d2aa'; ctx.fillRect(0, 0, c.width, c.height);
    if (plan) ctx.drawImage(plan, 0, 0, c.width, c.height);
    // Les lieux du carnet déjà trouvés : une croix de vermillon.
    ctx.strokeStyle = '#b3341f'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    monde.lieux.forEach(function (l) {
      var px, py;
      if (!vus[l.id] || l.x === undefined) return;
      px = surPlan(l.x) * k; py = surPlan(l.y) * k;
      ctx.beginPath(); ctx.moveTo(px - 7, py - 7); ctx.lineTo(px + 7, py + 7); ctx.moveTo(px + 7, py - 7); ctx.lineTo(px - 7, py + 7); ctx.stroke();
    });
    fleche(ctx, surPlan(x) * k, surPlan(y) * k, 9);
  }
  function basculerCarte() {
    if (!pret) return;
    if (!$('#carte').hidden) { fermerCarte(); return; }
    $('#carte').hidden = false;
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    dessinerCarte();
  }
  function fermerCarte() { $('#carte').hidden = true; }
  $('#agrandir').addEventListener('click', function (e) { basculerCarte(); if (e.detail) e.currentTarget.blur(); });
  $('#replier').addEventListener('click', function () { fermerCarte(); if (actif) entrer(false); });
  $('#carteToile').addEventListener('click', function (e) {
    var b = e.currentTarget.getBoundingClientRect(), px = (e.clientX - b.left) / b.width * ville.model.px, py = (e.clientY - b.top) / b.height * ville.model.px, lim = monde.collision.limite - 2;
    var x = (px - ville.model.px / 2) / ville.model.k * monde.S, y = (py - ville.model.px / 2) / ville.model.k * monde.S, l = Math.sqrt(x * x + y * y);
    if (l > lim) { x *= lim / l; y *= lim / l; }
    fermerCarte();
    porter(x, y, 0);
    quartier = '';
    if ($('#seuil').hidden) entrer(false);
  });

  // ---------- Heure, qualité, image ----------
  function viserHeure(h) {
    heureVisee = h;
    $('#heure').value = h;
    Array.prototype.forEach.call($('#heures').children, function (b) { b.setAttribute('aria-pressed', String(Math.abs(+b.getAttribute('data-heure') - h) < 0.05)); });
  }
  function reglages() {
    $('#heures').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { viserHeure(+b.getAttribute('data-heure')); if (e.detail) b.blur(); } });
    $('#heure').addEventListener('input', function (e) { viserHeure(+e.target.value); heure = heureVisee; });
    $('#heure').addEventListener('change', function (e) { e.target.blur(); });
    $('#qualites').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      choix = palier = b.getAttribute('data-qualite'); mesure.fige = true;
      memoire('visite-qualite', choix);
      montrerQualite();
      if (e.detail) b.blur();
    });
    $('#survol').addEventListener('click', function (e) { basculerSurvol(); if (e.detail) e.currentTarget.blur(); });
    $('#image').addEventListener('click', function (e) { garderImage(); if (e.detail) e.currentTarget.blur(); });
    viserHeure(heureVisee);
    montrerQualite();
  }
  function montrerQualite() {
    Array.prototype.forEach.call($('#qualites').children, function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-qualite') === palier)); });
  }
  // Sans choix du visiteur, la finesse se règle sur la cadence : on descend si les images tardent, on ne monte qu'une fois.
  function jauger(dt) {
    var moy, i;
    if (choix !== 'auto' || mesure.fige || !actif || document.hidden) return;
    if (mesure.saute > 0) { mesure.saute--; return; }
    mesure.n++; mesure.somme += dt;
    if (mesure.n < 70 && mesure.somme < 1.5) return;
    moy = mesure.somme / mesure.n; i = PALIERS.indexOf(palier);
    mesure.n = 0; mesure.somme = 0; mesure.saute = 12;
    if (moy > 0.026 && i > 0) { palier = PALIERS[i - 1]; mesure.monte = true; }
    else if (moy < 0.0175 && i < 2 && !mesure.monte) { palier = PALIERS[i + 1]; mesure.monte = true; }
    else return;
    montrerQualite();
  }

  function garderImage() {
    if (!pret) return;
    peindre();
    toile.toBlob(function (blob) {
      var a = document.createElement('a'), url;
      if (!blob) return;
      url = URL.createObjectURL(blob);
      a.href = url;
      a.download = 'visite-' + ville.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
  }

  // ---------- Image ----------
  function camera() {
    var balance = survol || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.sin(chemin * 1.9) * 0.028 * Math.min(1, Math.sqrt(vx * vx + vy * vy) / PAS);
    return survol ? { x: vol.x, y: vol.h, z: vol.y, cap: cap, tangage: tangage, champ: CHAMP } : { x: w.x, y: w.z + Marche.YEUX + balance, z: w.y, cap: cap, tangage: tangage, champ: CHAMP };
  }
  function peindre() {
    var q = Rendu.QUALITES[palier], dpr = Math.min(window.devicePixelRatio || 1, 2) * q.echelle;
    rendu.taille(Math.max(2, Math.round(toile.clientWidth * dpr)), Math.max(2, Math.round(toile.clientHeight * dpr)));
    stats = rendu.dessine(camera(), { heure: heure, temps: temps }, q);
  }
  function image(maintenant) {
    var dt = Math.min(0.25, Math.max(0, (maintenant - dernier) / 1000)), d, reste;
    dernier = maintenant;
    requestAnimationFrame(image);
    if (rendu.perdu()) return;
    temps += dt;
    // L'heure glisse vers celle qu'on a choisie, par le plus court chemin autour du cadran.
    d = ((heureVisee - heure) % 24 + 36) % 24 - 12;
    heure = (heure + (Math.abs(d) < 0.02 ? d : d * Math.min(1, dt * 1.8)) + 24) % 24;
    // Quand les images tardent, la marche se découpe en pas courts : on garde sa vitesse et la justesse des collisions.
    for (reste = dt; reste > 1e-5; reste -= 1 / 30) avancer(Math.min(reste, 1 / 30));
    reperer(maintenant);
    peindre();
    dessinerMini();
    $('#rose').style.transform = 'rotate(' + (-(cap + Math.PI / 2)) + 'rad)';
    jauger(dt);
    lisse += (dt * 1000 - lisse) * 0.05;
    if (cadence) $('#cadence').textContent = Math.round(1000 / lisse) + ' images/s, ' + stats.appels + ' + ' + stats.appelsOmbre + ' appels, ' + Math.round((stats.triangles + stats.trianglesOmbre) / 1000) + ' k triangles, ' + palier;
  }

  toile.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    $('#seuil').hidden = false; $('#chantier').hidden = false;
    panne('L\'affichage s\'est interrompu : la carte graphique a repris la main. Recharge la page pour revenir en ville.');
  });

  // Pour les essais : placer le visiteur, régler l'heure et la finesse, lire l'état.
  window.Visite = {
    etat: function () { return { pret: pret, actif: actif, capture: capture, x: w && w.x, y: w && w.y, z: w && w.z, cap: cap, tangage: tangage, survol: survol, vol: vol, heure: heure, palier: palier, quartier: quartier, vus: Object.keys(vus), stats: stats, erreur: rendu && rendu.erreur ? rendu.erreur() : -1, plan: !!plan }; },
    monde: function () { return monde; },
    rendu: function () { return rendu; },
    entrer: function () { entrer(true); },
    placer: function (x, y, c, t, z) { w = marche.nouveau(x, y); if (z) { w.z = z; w.z = marche.sol(x, y, z + 0.2); } survol = false; vx = vy = 0; if (c !== undefined) cap = c; if (t !== undefined) tangage = t; },
    planer: function (x, y, h, c, t) { survol = true; vol.x = x; vol.y = y; vol.h = h; cap = c; tangage = t; },
    heure: function (h) { viserHeure(h); heure = h; },
    qualite: function (q) { choix = palier = q; mesure.fige = true; montrerQualite(); },
    pose: function (x, y) { return marche.pose(x, y); },
    peindre: peindre
  };

  demarrer();
})();
