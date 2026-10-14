/* Carte des services : le plan du réseau de la 3DS vu par un jeu.
   Les données (DONNEES, decoderEnTete, trouverEnTete, regionDe) viennent de donnees.js. */
(function () {
  'use strict';

  const D = DONNEES;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const $ = s => document.querySelector(s);
  const famille = Object.fromEntries(D.familles.map(f => [f.id, f]));
  const module_ = Object.fromEntries(D.modules.map(m => [m.id, m]));
  const service = Object.fromEntries(D.services.map(s => [s.id, s]));
  const svcParNum = Object.fromEntries(D.svc.map(s => [s.n, s]));

  /* ------------------------------------------------------------ petits outils */
  const hex = (v, n) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(n || 8, '0');
  const echap = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function el(nom, attrs, parent) {
    const e = document.createElementNS(SVGNS, nom);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function taille(o) {
    if (!o) return '0';
    const u = [[1 << 30, 'Gio'], [1 << 20, 'Mio'], [1 << 10, 'Kio']];
    for (const [v, n] of u) if (o >= v && o % (v / 4) === 0) return (o / v).toLocaleString('fr-FR') + ' ' + n;
    return o.toLocaleString('fr-FR') + ' octets';
  }
  function lien3dbrew(url, texte) {
    return '<a class="lien-3dbrew" href="' + echap(url) + '" target="_blank" rel="noopener">' + echap(texte || 'Lire la page 3dbrew') + '</a>';
  }
  /* Notes « vu dans le code » (champ seen, posé par corrections.js) : ce qu'un module lu dans le code de la console
     dit d'une entrée, à côté de ce que dit 3dbrew. */
  const codeSource = D.codeSource || { fiches: '../decompil-3ds/fiches/', modules: [] };
  function ficheLink(moduleId, label) {
    return '<a class="lien-fiche" href="' + echap(codeSource.fiches + moduleId + '.md') + '" target="_blank" rel="noopener">' + echap(label || 'fiche de ' + moduleId) + '</a>';
  }
  // reference : l'en-tête de 3dbrew, pour dire en quoi celui du code diffère.
  function seenText(note, reference) {
    let h = '<b>Vu dans le code de ' + echap(note.module) + ' :</b> ';
    if (note.h && reference) h += 'l\'en-tête est <code>' + echap(note.h) + '</code>, et non <code>' + echap(reference) + '</code> comme sur 3dbrew. ';
    return h + echap(note.text) + ' ' + ficheLink(note.module);
  }
  function seenNotes(entry, reference) {
    return (entry.seen || []).map(n => '<p class="note vu-code">' + seenText(n, reference) + '</p>').join('');
  }
  // D'où vient un lien entre un module et un service : 3dbrew, le code, ou les deux quand ils ne disent pas la même chose.
  function callSource(call) {
    if (!call.url) return (call.seen || []).map(n => ficheLink(n.module, 'vu dans le code de ' + n.module)).join(' ');
    return lien3dbrew(call.url, '3dbrew') + (call.seen || []).map(n => '<br><span class="note">' + seenText(n) + '</span>').join('');
  }
  const headerFromCode = c => (c.seen || []).some(n => n.byCode);
  function seenMark(c) {
    if (!c.seen || !c.seen.length) return '';
    const other = c.seen.find(n => n.h);
    const title = headerFromCode(c) ? 'En-tête lu dans le code de la console : 3dbrew ne le donne pas en entier'
      : other ? 'Le code de la console écrit ' + other.h + ' et non ' + c.h
      : 'Le code de la console en dit plus : ouvre la commande';
    return ' <span class="marque-vu" title="' + echap(title) + '">vu dans le code</span>';
  }

  function plaque(m, petite) {
    const f = famille[m.famille];
    const carre = m.famille === 'materiel';
    return '<span class="plaque' + (carre ? ' carree' : '') + (petite ? ' petite' : '') + '" style="--c:' + f.couleur + '" title="Ligne ' + m.ligne + ', ' + echap(m.nom) + '">' + m.ligne + '</span>';
  }
  const servicesTries = m => m.services.slice().sort((a, b) => (service[b].jeu ? 1 : 0) - (service[a].jeu ? 1 : 0));

  /* ------------------------------------------------------------ mise en place du plan */
  const L = { BUNDLE: 11, ROW: 58, FAMGAP: 40, STEP: 20, SP: 98, HUBW: 168, DEPART: 34 };
  const COTES = [
    { sens: 1, familles: ['systeme', 'fichiers', 'image', 'video', 'son', 'entrees'] },
    { sens: -1, familles: ['enligne', 'internet', 'local', 'reglages'] }
  ];
  const geo = { lignes: {}, stations: {}, familles: [], hub: null, ceinture: null, bornes: null };

  function calculer() {
    let hautMax = 0;
    for (const cote of COTES) {
      const lignes = [];
      for (const f of cote.familles) D.modules.filter(m => m.famille === f).forEach(m => lignes.push(m));
      cote.lignes = lignes;
      hautMax = Math.max(hautMax, lignes.length);
    }
    const hubH = hautMax * L.BUNDLE + 56;
    geo.hub = { x: -L.HUBW / 2, y: -hubH / 2, w: L.HUBW, h: hubH };
    let yMin = 0, yMax = 0, xMin = 0, xMax = 0;

    for (const cote of COTES) {
      const s = cote.sens, n = cote.lignes.length;
      // rangées : une par ligne, un espace de plus entre deux familles
      let y = 0, prec = null;
      const rangs = [];
      for (const m of cote.lignes) {
        if (prec && prec !== m.famille) y += L.FAMGAP;
        rangs.push(y); y += L.ROW; prec = m.famille;
      }
      const decal = -(y - L.ROW) / 2;
      const bord = s * L.HUBW / 2;
      const infos = cote.lignes.map((m, i) => {
        const ry = rangs[i] + decal, ey = (i - (n - 1) / 2) * L.BUNDLE;
        return { m, i, ry, ey, dy: ry - ey };
      });
      // rang de virage : les lignes extérieures tournent les premières pour que les diagonales restent parallèles
      const hautes = infos.filter(o => o.dy < 0), basses = infos.filter(o => o.dy > 0);
      hautes.forEach((o, k) => { o.rang = k; });
      basses.forEach((o, k) => { o.rang = basses.length - 1 - k; });
      infos.forEach(o => { if (o.rang == null) o.rang = 0; o.fin = L.DEPART + o.rang * L.STEP + Math.abs(o.dy); });
      const debutStations = bord + s * (Math.max(...infos.map(o => o.fin)) + 56);
      for (const o of infos) {
        const svcs = servicesTries(o.m);
        const bx = bord + s * (L.DEPART + o.rang * L.STEP);
        const ex = bx + s * Math.abs(o.dy);
        const xs = svcs.map((_, k) => debutStations + s * k * L.SP);
        const xFin = xs[xs.length - 1] + s * 30;
        const d = 'M' + bord + ' ' + o.ey + ' H' + bx + ' L' + ex + ' ' + o.ry + ' H' + xFin;
        geo.lignes[o.m.id] = { m: o.m, d, y: o.ry, xFin, sens: s, plaque: { x: xFin + s * 20, y: o.ry } };
        svcs.forEach((id, k) => { geo.stations[id] = { id, x: xs[k], y: o.ry, m: o.m }; });
        yMin = Math.min(yMin, o.ry); yMax = Math.max(yMax, o.ry);
        const largeurNom = 34 + o.m.nom.length * 11;
        if (s > 0) xMax = Math.max(xMax, xFin + 40 + largeurNom); else xMin = Math.min(xMin, xFin - 40 - largeurNom);
      }
      // titres de famille, au-dessus de la première rangée de chaque famille
      for (const f of cote.familles) {
        const premiere = infos.find(o => o.m.famille === f);
        if (premiere) geo.familles.push({ f: famille[f], x: debutStations - s * 12, y: premiere.ry - 40, sens: s });
      }
    }

    // la ceinture du matériel, sous le réseau
    const mat = D.modules.filter(m => m.famille === 'materiel');
    const maxSt = Math.max(...mat.map(m => m.services.length));
    const haut = yMax + 150;
    const x0 = -((maxSt - 1) * L.SP) / 2;
    geo.ceinture = { y: haut - 58, x: x0 - 40 };
    mat.forEach((m, j) => {
      const y = haut + j * L.ROW;
      const svcs = m.services;
      const xs = svcs.map((_, k) => x0 + k * L.SP);
      let d = 'M' + (x0 - 34) + ' ' + y + ' H' + (xs[xs.length - 1] + 30);
      const g = { m, d, y, xFin: x0 - 34, sens: -1, plaque: { x: x0 - 54, y } };
      if (m.id === 'pxi') {
        const xd = xs[xs.length - 1] + 40;
        g.d = 'M' + (x0 - 34) + ' ' + y + ' H' + xd + ' L' + (xd + 90) + ' ' + (y + 90) + ' H' + (xd + 170);
        geo.process9 = { x: xd + 170, y: y + 90 };
      }
      geo.lignes[m.id] = g;
      svcs.forEach((id, k) => { geo.stations[id] = { id, x: xs[k], y, m }; });
      yMax = Math.max(yMax, y);
    });
    geo.riviere = { y: yMax + 52 };
    geo.bornes = { x: xMin - 40, y: yMin - 110, w: (xMax - xMin) + 80, h: (geo.riviere.y + 150) - (yMin - 110) };
  }

  /* ------------------------------------------------------------ dessin */
  const svg = $('#plan');
  let monde, coucheHalo, coucheStations;

  function dessiner() {
    svg.innerHTML = '';
    const defs = el('defs', {}, svg);
    const motif = el('pattern', { id: 'hachure', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    el('rect', { width: 6, height: 6, fill: '#f7f7f4' }, motif);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#c6d9e4', 'stroke-width': 3 }, motif);

    monde = el('g', { id: 'monde' }, svg);
    const b = geo.bornes;
    el('rect', { class: 'papier', x: b.x - 2000, y: b.y - 2000, width: b.w + 4000, height: b.h + 4000 }, monde);

    // la rivière : la frontière entre l'ARM11 et l'ARM9
    const r = geo.riviere;
    const gR = el('g', { class: 'riviere' }, monde);
    const xa = b.x - 400, xb = b.x + b.w + 400;
    let d = 'M' + xa + ' ' + r.y;
    for (let x = xa; x < xb; x += 240) d += ' q60 -16 120 0 t120 0';
    d += ' V' + (r.y + 46);
    for (let x = xb; x > xa; x -= 240) d += ' q-60 16 -120 0 t-120 0';
    el('path', { d: d + ' Z', class: 'eau' }, gR);
    const tr = el('text', { x: b.x + 30, y: r.y + 29, class: 'nom-riviere' }, gR);
    tr.textContent = 'Frontière ARM11 / ARM9';
    const tr2 = el('text', { x: b.x + 30, y: r.y + 78, class: 'rive' }, gR);
    tr2.textContent = 'Rive ARM9 : Process9 tient la NAND, la carte de jeu et la cryptographie';

    // titres
    const gT = el('g', { class: 'titres' }, monde);
    for (const t of geo.familles) {
      const g = el('g', { class: 'titre-famille' }, gT);
      const tx = el('text', { x: t.x, y: t.y, 'text-anchor': t.sens > 0 ? 'start' : 'end' }, g);
      tx.textContent = t.f.nom;
      el('rect', { x: t.sens > 0 ? t.x : t.x - 26, y: t.y + 7, width: 26, height: 5, fill: t.f.couleur }, g);
    }
    const tc = el('text', { x: geo.ceinture.x, y: geo.ceinture.y, class: 'titre-ceinture' }, gT);
    tc.textContent = 'Ceinture du matériel : les modules que les autres appellent';

    // lignes
    const gL = el('g', { class: 'lignes' }, monde);
    for (const id in geo.lignes) {
      const g = geo.lignes[id], m = g.m, f = famille[m.famille];
      const grp = el('g', { class: 'ligne fam-' + m.famille, 'data-module': id }, gL);
      el('path', { d: g.d, class: 'trace-sous' }, grp);
      el('path', { d: g.d, class: 'trace', stroke: f.couleur }, grp);
      if (m.famille === 'enligne') el('path', { d: g.d, class: 'trace-filet' }, grp);
      el('path', { d: g.d, class: 'prise' }, grp);
    }

    // la gare centrale
    const h = geo.hub;
    const gH = el('g', { class: 'gare', tabindex: 0, role: 'button', 'aria-label': 'Le jeu, gare centrale' }, monde);
    el('rect', { x: h.x, y: h.y, width: h.w, height: h.h, rx: 22 }, gH);
    const t1 = el('text', { x: 0, y: -10, class: 'gare-nom' }, gH); t1.textContent = 'Le jeu';
    const t2 = el('text', { x: 0, y: 14, class: 'gare-sous' }, gH); t2.textContent = 'gare centrale';
    const t3 = el('text', { x: 0, y: 36, class: 'gare-code' }, gH); t3.textContent = 'svc 0x32';

    // Process9, sur l'autre rive
    if (geo.process9) {
      const p = geo.process9;
      const gP = el('g', { class: 'process9' }, monde);
      el('rect', { x: p.x, y: p.y - 15, width: 172, height: 30, rx: 15 }, gP);
      const tp = el('text', { x: p.x + 86, y: p.y + 5 }, gP); tp.textContent = 'Process9 (ARM9)';
    }

    coucheHalo = el('g', { class: 'halos' }, monde);
    coucheStations = el('g', { class: 'stations' }, monde);

    // plaques de terminus
    for (const id in geo.lignes) {
      const g = geo.lignes[id], m = g.m, f = famille[m.famille];
      const grp = el('g', { class: 'terminus', 'data-module': id, tabindex: 0, role: 'button', 'aria-label': 'Ligne ' + m.ligne + ', module ' + m.nom }, coucheStations);
      const p = g.plaque;
      if (m.famille === 'materiel') el('rect', { x: p.x - 14, y: p.y - 14, width: 28, height: 28, fill: f.couleur }, grp);
      else el('circle', { cx: p.x, cy: p.y, r: 15, fill: f.couleur }, grp);
      const tn = el('text', { x: p.x, y: p.y + 5.5, class: 'num' }, grp); tn.textContent = m.ligne;
      const tm = el('text', { x: p.x + g.sens * 24, y: p.y + 6, class: 'nom-module', 'text-anchor': g.sens > 0 ? 'start' : 'end' }, grp);
      tm.textContent = m.nom;
    }

    // stations
    for (const id in geo.stations) {
      const st = geo.stations[id], sv = service[id], f = famille[st.m.famille];
      const grp = el('g', { class: 'st' + (sv.jeu ? ' jeu' : ' systeme'), 'data-service': id, tabindex: 0, role: 'button', 'aria-label': 'Station ' + id + (sv.jeu ? ', ouverte aux jeux' : ', réservée au système') }, coucheStations);
      el('circle', { cx: st.x, cy: st.y, r: 16, class: 'prise' }, grp);
      if (sv.jeu) {
        el('circle', { cx: st.x, cy: st.y, r: 7.5, class: 'rond' }, grp);
      } else {
        el('rect', { x: st.x - 2, y: st.y - 13, width: 4, height: 9.5, fill: f.couleur, class: 'coche' }, grp);
      }
      const lbl = el('text', { x: st.x, y: st.y - (sv.jeu ? 15 : 18), class: 'nom-station' }, grp);
      lbl.textContent = id;
      // correspondances : les lignes des modules qui appellent ce service
      const app = (sv.appelants || []).filter(a => a !== st.m.id).map(a => module_[a]);
      app.forEach((a, k) => {
        const cx = st.x + (k - (app.length - 1) / 2) * 19, cy = st.y + 19;
        const c = el('g', { class: 'corresp' }, grp);
        if (a.famille === 'materiel') el('rect', { x: cx - 8, y: cy - 8, width: 16, height: 16, fill: famille[a.famille].couleur }, c);
        else el('circle', { cx, cy, r: 8.5, fill: famille[a.famille].couleur }, c);
        const tt = el('text', { x: cx, y: cy + 3.5 }, c); tt.textContent = a.ligne;
      });
    }
  }

  /* ------------------------------------------------------------ légende */
  function legende() {
    const lg = $('#legende');
    let h = '<ul class="familles">';
    for (const f of D.familles) {
      const style = f.id === 'materiel' ? 'tirets' : f.id === 'enligne' ? 'double' : 'plein';
      h += '<li title="' + echap(f.nomCouleur) + '"><i class="trait ' + style + '" style="--c:' + f.couleur + '"></i>' + echap(f.nom) + '</li>';
    }
    h += '</ul><ul class="signes">';
    h += '<li><i class="s-rond"></i>Ouverte aux jeux</li>';
    h += '<li><i class="s-coche"></i>Réservée au système</li>';
    h += '<li><i class="s-corresp">7</i>Appelée par la ligne 7</li>';
    h += '<li><i class="s-trouve"></i>Trouvée ou choisie</li>';
    h += '</ul>';
    lg.innerHTML = h;
  }

  /* ------------------------------------------------------------ zoom et déplacement */
  const vue = { x: 0, y: 0, k: 1 };
  function appliquer() {
    monde.setAttribute('transform', 'translate(' + vue.x + ' ' + vue.y + ') scale(' + vue.k + ')');
    svg.classList.toggle('loin', vue.k < 0.62);
    svg.classList.toggle('tres-loin', vue.k < 0.38);
  }
  function ensemble() {
    const r = svg.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const b = geo.bornes;
    const haut = 52, marge = 10;
    const k = Math.min((r.width - 2 * marge) / b.w, (r.height - haut - marge) / b.h);
    vue.k = k;
    vue.x = r.width / 2 - (b.x + b.w / 2) * k;
    vue.y = haut + (r.height - haut - marge) / 2 - (b.y + b.h / 2) * k;
    appliquer();
  }
  function zoomer(f, cx, cy) {
    const r = svg.getBoundingClientRect();
    if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    const k = Math.max(0.12, Math.min(4, vue.k * f));
    const wx = (cx - vue.x) / vue.k, wy = (cy - vue.y) / vue.k;
    vue.k = k; vue.x = cx - wx * k; vue.y = cy - wy * k;
    appliquer();
  }
  function centrerSur(x, y, k) {
    const r = svg.getBoundingClientRect();
    if (k) vue.k = k;
    vue.x = r.width / 2 - x * vue.k;
    vue.y = r.height / 2 - y * vue.k;
    appliquer();
  }
  function cadrer(ids) {
    const pts = ids.map(id => geo.stations[id]).filter(Boolean);
    if (!pts.length) return;
    const r = svg.getBoundingClientRect();
    if (r.width < 10) return;
    const x0 = Math.min(...pts.map(p => p.x)) - 90, x1 = Math.max(...pts.map(p => p.x)) + 90;
    const y0 = Math.min(...pts.map(p => p.y)) - 70, y1 = Math.max(...pts.map(p => p.y)) + 50;
    const k = Math.max(0.2, Math.min(1.1, (r.width - 20) / (x1 - x0), (r.height - 70) / (y1 - y0)));
    vue.k = k;
    vue.x = r.width / 2 - (x0 + x1) / 2 * k;
    vue.y = 52 + (r.height - 62) / 2 - (y0 + y1) / 2 * k;
    appliquer();
  }
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomer(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  const pointeurs = new Map();
  let glisse = null, pince = null, aBouge = false, cibleAppui = null;
  svg.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault();
    cibleAppui = e.target;
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    aBouge = false;
    if (pointeurs.size === 1) glisse = { x: e.clientX, y: e.clientY, vx: vue.x, vy: vue.y };
    else if (pointeurs.size === 2) {
      const [a, b] = [...pointeurs.values()];
      pince = { d: Math.hypot(a.x - b.x, a.y - b.y), k: vue.k };
      glisse = null;
    }
  });
  svg.addEventListener('pointermove', e => {
    if (!pointeurs.has(e.pointerId)) return;
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pince && pointeurs.size === 2) {
      const [a, b] = [...pointeurs.values()];
      const r = svg.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomer((pince.k * d / pince.d) / vue.k, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      aBouge = true;
    } else if (glisse) {
      const dx = e.clientX - glisse.x, dy = e.clientY - glisse.y;
      if (!aBouge && Math.abs(dx) + Math.abs(dy) > 4) {
        aBouge = true;
        try { svg.setPointerCapture(e.pointerId); } catch (err) { /* pointeur déjà relâché */ }
      }
      if (aBouge) {
        vue.x = glisse.vx + dx; vue.y = glisse.vy + dy; appliquer();
        svg.classList.add('glisse');
      }
    }
  });
  function lacher(e) {
    pointeurs.delete(e.pointerId);
    if (pointeurs.size < 2) pince = null;
    if (pointeurs.size === 0) { glisse = null; svg.classList.remove('glisse'); }
  }
  svg.addEventListener('pointerup', lacher);
  svg.addEventListener('pointercancel', lacher);

  svg.addEventListener('click', e => {
    if (aBouge) { aBouge = false; return; }
    const cible = cibleAppui && svg.contains(cibleAppui) ? cibleAppui : e.target;
    cibleAppui = null;
    const st = cible.closest('.st');
    if (st) return choisirStation(st.dataset.service);
    const t = cible.closest('.terminus, .ligne');
    if (t) return choisirModule(t.dataset.module);
    if (cible.closest('.gare')) return choisirJeu();
    if (cible.closest('.process9')) return choisirModule('pxi');
  });
  svg.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const st = e.target.closest('.st');
    if (st) { e.preventDefault(); return choisirStation(st.dataset.service); }
    const t = e.target.closest('.terminus');
    if (t) { e.preventDefault(); return choisirModule(t.dataset.module); }
    if (e.target.closest('.gare')) { e.preventDefault(); return choisirJeu(); }
  });

  $('#bEnsemble').addEventListener('click', ensemble);
  $('#bPlus').addEventListener('click', () => zoomer(1.4));
  $('#bMoins').addEventListener('click', () => zoomer(1 / 1.4));

  /* ------------------------------------------------------------ états du plan */
  function marquer(selection, trouves) {
    coucheHalo.innerHTML = '';
    svg.querySelectorAll('.actif, .estompe, .relie').forEach(n => n.classList.remove('actif', 'estompe', 'relie'));
    const garder = new Set();
    if (selection) {
      selection.modules.forEach(m => garder.add(m));
      svg.querySelectorAll('.ligne, .terminus').forEach(n => {
        if (!garder.has(n.dataset.module)) n.classList.add('estompe');
        else if (selection.principal === n.dataset.module) n.classList.add('actif');
        else n.classList.add('relie');
      });
      svg.querySelectorAll('.st').forEach(n => {
        const m = service[n.dataset.service].module;
        if (!garder.has(m)) n.classList.add('estompe');
      });
    }
    const ids = new Set([...(trouves || []), ...((selection && selection.stations) || [])]);
    for (const id of ids) {
      const st = geo.stations[id];
      if (!st) continue;
      el('circle', { cx: st.x, cy: st.y, r: 19, class: 'halo' }, coucheHalo);
      const n = svg.querySelector('.st[data-service="' + CSS.escape(id) + '"]');
      if (n) { n.classList.add('actif'); n.classList.remove('estompe'); }
    }
    if (selection && selection.principal && !selection.stations.length) {
      const g = geo.lignes[selection.principal];
      if (g) el('path', { d: g.d, class: 'halo-ligne' }, coucheHalo);
    }
  }
  function voisins(mid) {
    const s = new Set([mid]);
    for (const a of module_[mid].appelle) s.add(service[a.service].module);
    for (const m of D.modules) if (m.appelle.some(a => service[a.service].module === mid)) s.add(m.id);
    return s;
  }

  /* ------------------------------------------------------------ fiches */
  const panneau = $('#panneau');
  let trouvesCourants = [];

  function enTeteTexte(h) {
    const d = decoderEnTete(h);
    return d.normaux + ' + ' + d.traduction;
  }
  function detailCommande(c) {
    const d = decoderEnTete(c.h);
    let h = '<div class="detail">';
    h += '<p class="decodage"><code>' + c.h + '</code> : commande <code>' + hex(d.commande, 4) + '</code>, ' + d.normaux + (d.normaux > 1 ? ' paramètres normaux' : ' paramètre normal') + ', ' + d.traduction + ' mot' + (d.traduction > 1 ? 's' : '') + ' de traduction.</p>';
    const det = c.p && D.details[c.p];
    if (det) {
      if (det.desc) h += '<p class="desc" lang="en">' + echap(det.desc) + '</p>';
      const liste = (titre, l) => {
        if (!l || !l.length) return '';
        let s = '<h4>' + titre + '</h4><table class="mots"><tbody>';
        for (const [i, t] of l) s += '<tr><th>' + echap(i) + '</th><td lang="en">' + echap(t) + '</td></tr>';
        return s + '</tbody></table>';
      };
      h += liste('Requête, après l\'en-tête', det.req) + liste('Réponse, après l\'en-tête', det.rep);
    } else if (c.nonLue) {
      h += '<p class="non-lue">Page non lue : la page 3dbrew de cette commande n\'a pas pu être consultée. L\'en-tête suffit pour compter les paramètres.</p>';
    } else if (headerFromCode(c)) {
      h += '<p class="non-lue">3dbrew ne donne pas l\'en-tête entier de cette commande : celui-ci vient du code de la console.</p>';
    } else {
      h += '<p class="non-lue">3dbrew n\'a pas de page à part pour cette commande : tout ce qu\'il en dit est ici.</p>';
    }
    if (c.corrige) h += '<p class="note"><b>Correction :</b> ' + echap(c.corrige) + '</p>';
    h += seenNotes(c, c.h);
    if (c.note) h += '<p class="note" lang="en">' + echap(c.note) + '</p>';
    if (c.entree) h += '<p class="note"><b>Entrée :</b> <span lang="en">' + echap(c.entree) + '</span></p>';
    if (c.sortie) h += '<p class="note"><b>Sortie :</b> <span lang="en">' + echap(c.sortie) + '</span></p>';
    const extra = [];
    if (c.depuis) extra.push('depuis la version ' + echap(c.depuis));
    if (c.droits && c.droits !== 'None') extra.push('droits requis : <code>' + echap(c.droits) + '</code>');
    if (extra.length) h += '<p class="note">' + extra.join(' ; ') + '.</p>';
    h += '<p>' + lien3dbrew(c.url) + '</p></div>';
    return h;
  }
  function tableCommandes(sv, ouvrir) {
    const cmds = sv.commandes;
    if (!cmds.length) {
      return '<p class="vide">' + (sv.sansTable ? '3dbrew ne liste pas de commandes pour ce service.' : 'Aucune commande complète.') + '</p>' + incompleteHeaders(sv);
    }
    let h = '<div class="filtre"><label>Filtrer les horaires <input type="search" class="filtre-cmd" placeholder="nom ou en-tête"></label><span class="compte">' + cmds.length + ' commande' + (cmds.length > 1 ? 's' : '') + '</span></div>';
    h += '<table class="horaires"><thead><tr><th>En-tête</th><th>Commande</th><th title="Paramètres normaux + mots de traduction">Param.</th></tr></thead><tbody>';
    for (const c of cmds) {
      h += '<tr class="cmd' + (c.h === ouvrir ? ' ouverte' : '') + '" data-h="' + c.h + '" tabindex="0"><td><code>' + c.h + '</code></td><td>' + echap(c.n) + (c.nonLue ? ' <span class="marque-nl" title="La page 3dbrew de cette commande n\'a pas pu être lue">page non lue</span>' : '') + seenMark(c) + '</td><td class="num">' + enTeteTexte(c.h) + '</td></tr>';
      if (c.h === ouvrir) h += '<tr class="ligne-detail"><td colspan="3">' + detailCommande(c) + '</td></tr>';
    }
    h += '</tbody></table>';
    return h + incompleteHeaders(sv);
  }
  // Les en-têtes que 3dbrew ne donne pas en entier : une phrase, ou une liste quand il y a plus à dire sur l'un d'eux.
  function incompleteHeaders(sv) {
    const list = sv.partiels || [];
    if (!list.length) return '';
    if (!list.some(p => p.note || p.seen)) {
      return '<p class="note">En-têtes incomplets sur 3dbrew : ' + list.map(p => '<code>' + echap(p.brut) + '</code> ' + echap(p.n)).join(', ') + '.</p>';
    }
    let h = '<p class="note">En-têtes incomplets sur 3dbrew :</p><ul class="partiels">';
    for (const p of list) {
      h += '<li><code>' + echap(p.brut) + '</code> ' + echap(p.n) + (p.note ? ' <span class="pale" lang="en">' + echap(p.note) + '</span>' : '') + seenNotes(p) + '</li>';
    }
    return h + '</ul>';
  }
  function brancherTable(sv) {
    const table = panneau.querySelector('.horaires');
    if (!table) return;
    const basculer = tr => {
      const suiv = tr.nextElementSibling;
      if (suiv && suiv.classList.contains('ligne-detail')) { suiv.remove(); tr.classList.remove('ouverte'); return; }
      const c = sv.commandes.find(x => x.h === tr.dataset.h);
      const n = document.createElement('tr');
      n.className = 'ligne-detail';
      n.innerHTML = '<td colspan="3">' + detailCommande(c) + '</td>';
      tr.after(n); tr.classList.add('ouverte');
    };
    table.addEventListener('click', e => {
      if (e.target.closest('a')) return;
      const tr = e.target.closest('tr.cmd');
      if (tr) basculer(tr);
    });
    table.addEventListener('keydown', e => {
      const tr = e.target.closest('tr.cmd');
      if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); basculer(tr); }
    });
    const filtre = panneau.querySelector('.filtre-cmd');
    filtre.addEventListener('input', () => {
      const q = filtre.value.trim().toLowerCase();
      table.querySelectorAll('tr.cmd').forEach(tr => {
        const c = sv.commandes.find(x => x.h === tr.dataset.h);
        const ok = !q || c.n.toLowerCase().includes(q) || c.h.toLowerCase().includes(q.replace(/^0x/, '')) ;
        tr.hidden = !ok;
        const s = tr.nextElementSibling;
        if (s && s.classList.contains('ligne-detail')) s.hidden = !ok;
      });
    });
  }

  function enteteFiche(m, titre, sousTitre) {
    return '<header class="fiche-tete" style="--c:' + famille[m.famille].couleur + '">' + plaque(m) +
      '<div><p class="fiche-ligne">Ligne ' + m.ligne + ', ' + echap(famille[m.famille].nom.toLowerCase()) + '</p><h2>' + titre + '</h2>' +
      (sousTitre ? '<p class="fiche-sous">' + sousTitre + '</p>' : '') + '</div></header>';
  }

  function choisirStation(id, cmdOuverte, sansCentrer) {
    const sv = service[id];
    if (!sv) return;
    const m = module_[sv.module];
    montrerVue('plan');
    let h = enteteFiche(m, '<span class="code-station">' + echap(id) + '</span>', sv.jeu ? 'Station ouverte aux jeux' : 'Service réservé au système');
    h += '<div class="fiche-corps">';
    if (sv.role) h += '<p class="role">' + echap(sv.role) + '</p>';
    h += '<p>Exposé par le module <button type="button" class="renvoi" data-module="' + m.id + '">' + echap(m.nom) + '</button>. ' + lien3dbrew(sv.url) + '</p>';
    h += seenNotes(sv);
    if (sv.appelants && sv.appelants.length) {
      h += '<h3>Correspondances</h3><ul class="corresp-liste">';
      for (const a of sv.appelants) {
        const am = module_[a];
        const ap = am.appelle.find(x => x.service === id);
        h += '<li>' + plaque(am, true) + ' <button type="button" class="renvoi" data-module="' + a + '">' + echap(am.nom) + '</button> appelle ce service. <span class="pale">' + echap(ap.note) + '</span> ' + callSource(ap) + '</li>';
      }
      h += '</ul>';
    }
    h += '<h3>Horaires : les commandes IPC</h3>' + tableCommandes(sv, cmdOuverte);
    h += '</div>';
    panneau.innerHTML = h;
    panneau.scrollTop = 0;
    brancherTable(sv);
    brancherRenvois();
    const ouverte = panneau.querySelector('tr.ouverte');
    if (ouverte) ouverte.scrollIntoView({ block: 'center', inline: 'nearest' });
    marquer({ principal: m.id, modules: new Set([m.id, ...(sv.appelants || [])]), stations: [id] }, trouvesCourants);
    const st = geo.stations[id];
    if (st && !sansCentrer) centrerSur(st.x + (window.innerWidth > 760 ? 0 : 0), st.y, Math.max(vue.k, 0.9));
    memoriser('s=' + id);
  }

  function choisirModule(mid, sansCentrer) {
    const m = module_[mid];
    if (!m) return;
    montrerVue('plan');
    let h = enteteFiche(m, echap(m.nom), m.titre ? 'Titre <code>' + m.titre + '</code>' : 'Module système');
    h += '<div class="fiche-corps"><p class="role">' + echap(m.role) + '</p>';
    h += '<dl class="faits"><dt>Processeur</dt><dd>' + echap(m.processeur) + '</dd><dt>Couleur</dt><dd>' + echap(famille[m.famille].nomCouleur) + ', comme toute la famille « ' + echap(famille[m.famille].nom) + ' »</dd></dl>';
    h += '<h3>Stations</h3><ul class="stations-liste">';
    for (const s of servicesTries(m)) {
      const sv = service[s];
      h += '<li><button type="button" class="renvoi code" data-service="' + echap(s) + '">' + echap(s) + '</button> <span class="pale">' + (sv.jeu ? 'ouverte aux jeux' : 'système') + ', ' + sv.commandes.length + ' commande' + (sv.commandes.length > 1 ? 's' : '') + '</span>' + (sv.role ? '<br>' + echap(sv.role) : '') + '</li>';
    }
    h += '</ul>';
    if (m.appelle.length) {
      h += '<h3>Ce module appelle</h3><ul class="corresp-liste">';
      for (const a of m.appelle) {
        const cible = module_[service[a.service].module];
        h += '<li>' + plaque(cible, true) + ' <button type="button" class="renvoi code" data-service="' + echap(a.service) + '">' + echap(a.service) + '</button> <span class="pale">' + echap(a.note) + '</span> ' + callSource(a) + '</li>';
      }
      h += '</ul>';
    }
    const appelePar = D.modules.filter(x => x.appelle.some(a => service[a.service].module === mid));
    if (appelePar.length) {
      h += '<h3>Il est appelé par</h3><p>' + appelePar.map(x => plaque(x, true) + ' <button type="button" class="renvoi" data-module="' + x.id + '">' + echap(x.nom) + '</button>').join(' ') + '</p>';
    }
    h += '<p>' + lien3dbrew(m.url) + '</p>';
    if (codeSource.modules.includes(mid)) h += '<p class="note vu-code">Ce module a été lu dans le code de la console : ' + ficheLink(mid, 'lire la fiche de ' + mid) + '</p>';
    h += '</div>';
    panneau.innerHTML = h;
    panneau.scrollTop = 0;
    brancherRenvois();
    marquer({ principal: mid, modules: voisins(mid), stations: [] }, trouvesCourants);
    const g = geo.lignes[mid];
    if (g && !sansCentrer) {
      const xs = m.services.map(s => geo.stations[s].x);
      centrerSur((Math.min(...xs) + Math.max(...xs)) / 2, g.y, Math.max(Math.min(vue.k, 1), 0.7));
    }
    memoriser('m=' + mid);
  }

  function choisirJeu() {
    montrerVue('plan');
    const jeu = D.services.filter(s => s.jeu);
    let h = '<header class="fiche-tete gare-tete"><span class="plaque-gare">J</span><div><p class="fiche-ligne">Gare centrale</p><h2>Le jeu</h2><p class="fiche-sous">Une application, vue depuis ses appels</p></div></header>';
    h += '<div class="fiche-corps"><p class="role">Un jeu ne touche presque jamais le matériel : il demande. Il commence par se présenter à <button type="button" class="renvoi code" data-service="srv:">srv:</button> (RegisterClient), puis obtient une poignée vers chaque service par son nom (GetServiceHandle).</p>';
    h += '<p>Pour chaque commande, il écrit le message à l\'adresse de son stockage local de thread plus <code>0x80</code> : d\'abord l\'en-tête, puis les paramètres normaux, puis les paramètres de traduction (poignées, tampons). Il appelle ensuite <button type="button" class="renvoi code" data-svc="50">svc 0x32</button>, SendSyncRequest, et lit la réponse au même endroit. Le deuxième mot de la réponse est le code de résultat.</p>';
    h += '<h3>Décoder un en-tête</h3><table class="bits"><thead><tr><th>Bits</th><th>Champ</th></tr></thead><tbody>';
    for (const c of D.ipc.champs) h += '<tr><td><code>' + c.bits[1] + '–' + c.bits[0] + '</code></td><td><b>' + echap(c.nom) + '</b><br>' + echap(c.desc) + '</td></tr>';
    h += '</tbody></table><p>Exemple : <button type="button" class="renvoi code" data-q="0x080201C2">0x080201C2</button> se lit commande <code>0x0802</code>, 7 paramètres normaux, 2 mots de traduction. ' + lien3dbrew(D.ipc.url) + '</p>';
    h += '<h3>Descripteurs de traduction</h3><table class="bits"><tbody>';
    for (const t of D.ipc.traductions) h += '<tr><td><code>' + t.motif + '</code></td><td><b>' + echap(t.nom) + '</b><br>' + echap(t.desc) + '</td></tr>';
    h += '</tbody></table>';
    h += '<h3>Les ' + jeu.length + ' stations ouvertes aux jeux</h3><ul class="stations-liste colonnes">';
    for (const s of jeu) h += '<li>' + plaque(module_[s.module], true) + ' <button type="button" class="renvoi code" data-service="' + echap(s.id) + '">' + echap(s.id) + '</button></li>';
    h += '</ul></div>';
    panneau.innerHTML = h;
    panneau.scrollTop = 0;
    brancherRenvois();
    marquer({ principal: null, modules: new Set(jeu.map(s => s.module)), stations: jeu.map(s => s.id) }, trouvesCourants);
    ensemble();
    memoriser('jeu');
  }

  function choisirSvc(n) {
    const s = svcParNum[n];
    if (!s) return;
    let h = '<header class="fiche-tete svc-tete"><span class="plaque-svc">' + hex(n, 2) + '</span><div><p class="fiche-ligne">Appel système</p><h2>' + echap(s.nom) + '</h2><p class="fiche-sous"><code>svc ' + hex(n, 2) + '</code></p></div></header>';
    h += '<div class="fiche-corps"><pre class="signature">' + echap(s.sig) + '</pre>';
    h += '<dl class="faits"><dt>ARM11 (NATIVE_FIRM)</dt><dd>' + (s.arm11 ? 'oui' : 'non') + '</dd><dt>ARM9 (NATIVE_FIRM)</dt><dd>' + (s.arm9 ? 'oui' : 'non') + '</dd><dt>ARM11 (TWL_FIRM)</dt><dd>' + (s.twl ? 'oui' : 'non') + '</dd></dl>';
    if (s.note) h += '<p class="note" lang="en">' + echap(s.note) + '</p>';
    if (s.voir.length) h += '<p>Voir aussi : ' + s.voir.map(v => lien3dbrew(v.url, v.t.replace(/_/g, ' '))).join(', ') + '.</p>';
    h += '<p>' + lien3dbrew(s.url) + '</p></div>';
    panneau.innerHTML = h;
    panneau.scrollTop = 0;
    memoriser('svc=' + hex(n, 2));
  }

  function choisirRegion(vueMem, modele, index) {
    const liste = vueMem === 'fcram' ? D.memoire.fcram[modele] : D.memoire[vueMem][modele];
    const z = liste[index];
    const base = vueMem === 'fcram' ? D.memoire.fcram.base : 0;
    const titres = { virtuelle: 'Vue du jeu (adresses virtuelles)', physique: 'Mémoire physique de l\'ARM11', fcram: 'Partage de la FCRAM' };
    let h = '<header class="fiche-tete mem-tete"><span class="plaque-mem">' + (modele === 'new' ? 'N' : 'A') + '</span><div><p class="fiche-ligne">' + titres[vueMem] + ', ' + (modele === 'new' ? 'New 3DS' : 'ancienne 3DS') + '</p><h2>' + echap(z.nom) + '</h2></div></header>';
    h += '<div class="fiche-corps"><dl class="faits"><dt>Début</dt><dd><code>' + hex(z.debut + base) + '</code></dd>';
    if (z.taille) h += '<dt>Fin</dt><dd><code>' + hex(z.debut + base + z.taille - 1) + '</code></dd><dt>Taille</dt><dd><code>' + hex(z.taille) + '</code>, ' + taille(z.taille) + (z.tailleConnue === false ? ' (taille indicative)' : '') + '</dd>';
    h += '</dl>';
    if (z.desc) h += '<p class="role">' + echap(z.desc) + '</p>';
    h += '<p>' + lien3dbrew(z.url) + '</p></div>';
    panneau.innerHTML = h;
  }

  function brancherRenvois() {
    panneau.querySelectorAll('.renvoi').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.service) choisirStation(b.dataset.service, b.dataset.h);
      else if (b.dataset.module) choisirModule(b.dataset.module);
      else if (b.dataset.svc) { montrerVue('svc'); choisirSvc(+b.dataset.svc); }
      else if (b.dataset.q) { $('#question').value = b.dataset.q; chercher(b.dataset.q); }
      else if (b.dataset.adresse) { montrerVue('memoire', parseInt(b.dataset.adresse, 16)); }
    }));
  }

  function accueil() {
    let h = '<header class="fiche-tete accueil-tete"><span class="plaque-gare">i</span><div><p class="fiche-ligne">Panneau d\'information</p><h2>Bienvenue sur le réseau</h2></div></header>';
    h += '<div class="fiche-corps"><p class="role">Chaque module système de la 3DS est une ligne, chaque service une station, et le jeu est la gare centrale. Touche une station pour lire ses horaires : les commandes IPC, avec leur en-tête, leurs paramètres et leur réponse.</p>';
    h += '<p>Au guichet, en haut, tape ce que tu as sous les yeux dans Ghidra :</p><ul class="exemples">';
    for (const [q, t] of [['0x08010100', 'un en-tête IPC'], ['svc 0x32', 'un appel système'], ['0x1FF82000', 'une adresse'], ['OpenFile', 'un nom de commande'], ['hid:USER', 'un service']]) {
      h += '<li><button type="button" class="renvoi code" data-q="' + q + '">' + q + '</button> ' + t + '</li>';
    }
    h += '</ul>';
    const nCmd = new Set(D.services.flatMap(s => s.commandes.map(c => s.id + c.h))).size;
    h += '<p class="pale">' + D.modules.length + ' modules, ' + D.services.length + ' services, ' + nCmd + ' commandes, ' + D.svc.length + ' appels système, tirés de 3dbrew. Chaque fiche renvoie à sa page.</p>';
    h += '<p><button type="button" class="renvoi" data-jeu="1" id="versJeu">Ouvrir la fiche du jeu</button></p></div>';
    panneau.innerHTML = h;
    brancherRenvois();
    $('#versJeu').addEventListener('click', choisirJeu);
  }

  /* ------------------------------------------------------------ le guichet */
  function chercher(q) {
    q = (q || '').trim();
    if (!q) { trouvesCourants = []; marquer(null, []); accueil(); return; }
    const res = { commandes: [], proches: [], services: [], modules: [], svc: [], regions: [] };
    const ql = q.toLowerCase();
    let m;
    if ((m = ql.match(/^svc\s*(?:0x)?([0-9a-f]{1,2})$/)) || (m = ql.match(/^0x([0-9a-f]{1,2})$/))) {
      const n = parseInt(m[1], 16);
      if (svcParNum[n]) res.svc.push(svcParNum[n]);
    }
    if ((m = ql.match(/^(?:0x)?([0-9a-f]{8})$/))) {
      const t = trouverEnTete('0x' + m[1]);
      const sought = parseInt(m[1], 16) >>> 0;
      const seen = [];
      for (const s of D.services) for (const c of s.commandes) {
        const note = (c.seen || []).find(n => n.h && (parseInt(n.h, 16) >>> 0) === sought);
        if (note) seen.push({ service: s.id, module: s.module, commande: c, seen: note });
      }
      res.commandes = seen.concat(t.exactes);
      res.proches = t.proches.filter(r => !seen.some(x => x.commande === r.commande)).slice(0, 40);
    }
    if ((m = ql.match(/^0x([0-9a-f]{4})$/))) {
      const id = parseInt(m[1], 16);
      for (const s of D.services) for (const c of s.commandes) if ((parseInt(c.h, 16) >>> 16) === id) res.commandes.push({ service: s.id, module: s.module, commande: c });
    }
    if ((m = ql.match(/^(?:0x)?([0-9a-f]{3,8})$/)) && (ql.startsWith('0x') || /\d/.test(ql))) {
      res.regions = regionDe(parseInt(m[1], 16));
      res.adresse = parseInt(m[1], 16);
    }
    if (!/^(svc\s*)?(0x)?[0-9a-f]+$/.test(ql) || /[g-z]/.test(ql)) {
      for (const s of D.services) if (s.id.toLowerCase().includes(ql)) res.services.push(s);
      for (const x of D.modules) if (x.id.toLowerCase().includes(ql) || x.nom.toLowerCase().includes(ql)) res.modules.push(x);
      const exact = [], partiel = [];
      for (const s of D.services) for (const c of s.commandes) {
        const n = c.n.toLowerCase();
        if (n === ql) exact.push({ service: s.id, module: s.module, commande: c });
        else if (ql.length >= 3 && n.includes(ql)) partiel.push({ service: s.id, module: s.module, commande: c });
      }
      // à la suite des commandes déjà trouvées par leur en-tête : le « x » de « 0x » fait aussi passer par ici
      res.commandes = res.commandes.concat(exact, partiel);
      for (const s of D.svc) if (s.nom.toLowerCase().includes(ql)) res.svc.push(s);
    }
    res.services.sort((a, b) => (a.id.toLowerCase() === ql ? -1 : 0) - (b.id.toLowerCase() === ql ? -1 : 0));
    afficherResultats(q, res);
  }

  function afficherResultats(q, res) {
    const total = res.commandes.length + (res.commandes.length ? 0 : (res.proches || []).length) + res.services.length + res.modules.length + res.svc.length + res.regions.length;
    const pistes = res.commandes.length ? res.commandes : (res.proches || []);
    trouvesCourants = [...new Set([...pistes.map(r => r.service), ...res.services.map(s => s.id), ...res.modules.flatMap(m => m.services)])];
    montrerVue(document.body.dataset.vue === 'plan' || res.commandes.length || res.services.length || res.modules.length ? 'plan' : document.body.dataset.vue);
    marquer(null, trouvesCourants);
    if (trouvesCourants.length && document.body.dataset.vue === 'plan') cadrer(trouvesCourants);
    // un seul service, ou un seul module : on ouvre directement sa fiche
    if (res.services.length === 1 && res.services[0].id.toLowerCase() === q.toLowerCase()) return choisirStation(res.services[0].id);
    let h = '<header class="fiche-tete guichet-tete"><span class="plaque-gare">?</span><div><p class="fiche-ligne">Guichet d\'information</p><h2><code>' + echap(q) + '</code></h2><p class="fiche-sous">' + (total ? total + ' réponse' + (total > 1 ? 's' : '') : 'Aucune réponse') + '</p></div></header><div class="fiche-corps">';
    if ((/^(?:0x)?[0-9a-f]{8}$/i).test(q) && (res.commandes.length || (res.proches || []).length)) {
      const d = decoderEnTete(q.replace(/^(?!0x)/i, '0x'));
      h += '<p class="decodage">Lu comme en-tête IPC : commande <code>' + hex(d.commande, 4) + '</code>, ' + d.normaux + (d.normaux > 1 ? ' paramètres normaux' : ' paramètre normal') + ', ' + d.traduction + ' mot' + (d.traduction > 1 ? 's' : '') + ' de traduction.</p>';
    }
    if (res.svc.length) {
      h += '<h3>Appels système</h3><ul class="resultats">';
      for (const s of res.svc) h += '<li><button type="button" class="renvoi code" data-svc="' + s.n + '">svc ' + hex(s.n, 2) + '</button> ' + echap(s.nom) + '</li>';
      h += '</ul>';
    }
    if (res.commandes.length) {
      h += '<h3>Commandes IPC</h3><ul class="resultats">';
      for (const r of res.commandes.slice(0, 120)) h += '<li>' + plaque(module_[r.module], true) + ' <button type="button" class="renvoi code" data-service="' + echap(r.service) + '" data-h="' + r.commande.h + '">' + echap(r.service) + '</button> <code>' + r.commande.h + '</code> ' + echap(r.commande.n) + (r.seen ? ' <span class="marque-vu">' + echap(r.seen.h) + ' dans le code de ' + echap(r.seen.module) + '</span>' : '') + '</li>';
      h += '</ul>';
      if (res.commandes.length > 120) h += '<p class="pale">Et ' + (res.commandes.length - 120) + ' autres : précise ta question.</p>';
    }
    if (res.proches && res.proches.length && !res.commandes.length) {
      h += '<h3>Même identifiant, autres paramètres</h3><ul class="resultats">';
      for (const r of res.proches) h += '<li>' + plaque(module_[r.module], true) + ' <button type="button" class="renvoi code" data-service="' + echap(r.service) + '" data-h="' + r.commande.h + '">' + echap(r.service) + '</button> <code>' + r.commande.h + '</code> ' + echap(r.commande.n) + '</li>';
      h += '</ul>';
    }
    if (res.services.length) {
      h += '<h3>Stations</h3><ul class="resultats">';
      for (const s of res.services) h += '<li>' + plaque(module_[s.module], true) + ' <button type="button" class="renvoi code" data-service="' + echap(s.id) + '">' + echap(s.id) + '</button></li>';
      h += '</ul>';
    }
    if (res.modules.length) {
      h += '<h3>Lignes</h3><ul class="resultats">';
      for (const x of res.modules) h += '<li>' + plaque(x, true) + ' <button type="button" class="renvoi" data-module="' + x.id + '">' + echap(x.nom) + '</button></li>';
      h += '</ul>';
    }
    if (res.regions.length) {
      h += '<h3>Mémoire : <code>' + hex(res.adresse) + '</code> tombe dans</h3><ul class="resultats">';
      const vues = { virtuelle: 'vue du jeu', physique: 'physique', fcram: 'FCRAM' };
      for (const r of res.regions) h += '<li><b>' + echap(r.region.nom) + '</b> <span class="pale">(' + vues[r.vue] + ', ' + (r.modele === 'new' ? 'New 3DS' : 'ancienne 3DS') + ', décalage <code>' + hex(r.decalage) + '</code>)</span></li>';
      h += '</ul><p><button type="button" class="renvoi" data-adresse="' + hex(res.adresse) + '">Voir sur le plan du quartier</button></p>';
    } else if (res.adresse != null && !res.commandes.length && !res.svc.length) {
      h += '<p>L\'adresse <code>' + hex(res.adresse) + '</code> ne tombe dans aucune région connue.</p>';
    }
    if (!total) h += '<p>Essaie un nom de service (<code>fs:USER</code>), une commande (<code>OpenFile</code>), un en-tête sur huit chiffres (<code>0x08010100</code>), un appel système (<code>svc 0x32</code>) ou une adresse (<code>0x1FF82000</code>).</p>';
    h += '</div>';
    panneau.innerHTML = h;
    panneau.scrollTop = 0;
    brancherRenvois();
    if (document.body.dataset.vue === 'memoire' && res.adresse != null) dessinerMemoire(res.adresse);
  }

  $('#guichet').addEventListener('submit', e => { e.preventDefault(); chercher($('#question').value); });

  /* ------------------------------------------------------------ plan du quartier : la mémoire */
  const vueMemoire = $('#vueMemoire');
  function hauteurBloc(t) {
    if (!t) return 26;
    return Math.round(26 + Math.max(0, Math.log2(t / 0x1000)) * 7.5);
  }
  function dessinerMemoire(adresse) {
    const surligne = r => adresse != null && r.taille > 0 && adresse >= r.debut && adresse < r.debut + r.taille;
    const colonne = (titre, liste, vueMem, modele, autre) => {
      let h = '<div class="colonne-mem"><h3>' + titre + '</h3><ol class="rue">';
      let fin = null;
      liste.forEach((r, i) => {
        if (fin != null && r.debut > fin) h += '<li class="trou"><span>non projeté</span></li>';
        const seul = !autre.some(o => o.debut === r.debut && o.taille === r.taille && o.nom === r.nom);
        const cls = ['bloc'];
        if (seul) cls.push('propre');
        if (surligne(r)) cls.push('trouve');
        if (r.borne) cls.push('borne');
        h += '<li class="' + cls.join(' ') + '" style="--h:' + hauteurBloc(r.taille) + 'px" data-vue="' + vueMem + '" data-modele="' + modele + '" data-i="' + i + '" tabindex="0" role="button">';
        h += '<code class="adr">' + hex(r.debut) + '</code><span class="nom-bloc">' + echap(r.nom) + '</span>';
        if (r.taille) h += '<span class="taille-bloc">' + taille(r.taille) + (r.tailleConnue === false ? ' ?' : '') + '</span>';
        h += '</li>';
        fin = r.debut + r.taille;
      });
      return h + '</ol></div>';
    };
    const V = D.memoire.virtuelle, P = D.memoire.physique, F = D.memoire.fcram;
    let h = '<div class="mem-entete"><h2>Plan du quartier : la mémoire</h2><p>Chaque îlot est une région ; sa hauteur suit le logarithme de sa taille. Les îlots hachurés diffèrent d\'un modèle à l\'autre.' + lien3dbrew(V.url, 'Memory layout sur 3dbrew') + '</p>';
    h += '<form class="adresse" id="formAdresse"><label>Adresse <input id="champAdresse" spellcheck="false" placeholder="0x1FF82000" value="' + (adresse != null ? hex(adresse) : '') + '"></label><button type="submit">Situer</button></form></div>';
    h += '<section class="quartier"><h3 class="sous-titre">Vue du jeu : les adresses virtuelles</h3><div class="cote-a-cote">' + colonne('Ancienne 3DS', V.old, 'virtuelle', 'old', V.new) + colonne('New 3DS', V.new, 'virtuelle', 'new', V.old) + '</div></section>';
    // FCRAM : deux barres à l'échelle
    const barre = (liste, total, modele) => {
      let s = '<div class="barre-fcram">';
      liste.forEach((r, i) => {
        const tr = adresse != null && adresse >= F.base + r.debut && adresse < F.base + r.debut + r.taille;
        s += '<button type="button" class="part p-' + r.nom.toLowerCase() + (tr ? ' trouve' : '') + '" style="flex:' + r.taille + '" data-vue="fcram" data-modele="' + modele + '" data-i="' + i + '"><b>' + r.nom + '</b> ' + taille(r.taille) + '</button>';
      });
      return s + '</div>';
    };
    h += '<section class="quartier"><h3 class="sous-titre">Partage de la FCRAM, à l\'échelle</h3>';
    h += '<p class="etiquette-barre">Ancienne 3DS, 128 Mio à <code>0x20000000</code></p>' + '<div class="barre-cadre" style="width:50%">' + barre(F.old, 0x08000000, 'old') + '</div>';
    h += '<p class="etiquette-barre">New 3DS, 256 Mio</p><div class="barre-cadre">' + barre(F.new, 0x10000000, 'new') + '</div>';
    h += '<p class="pale">' + lien3dbrew(F.url, 'FCRAM memory-regions layout') + '</p></section>';
    h += '<section class="quartier"><h3 class="sous-titre">Mémoire physique de l\'ARM11</h3><div class="cote-a-cote">' + colonne('Ancienne 3DS', P.old, 'physique', 'old', P.new) + colonne('New 3DS', P.new, 'physique', 'new', P.old) + '</div></section>';
    vueMemoire.innerHTML = h;
    vueMemoire.querySelectorAll('[data-vue][data-i]').forEach(b => {
      const ouvrir = () => choisirRegion(b.dataset.vue, b.dataset.modele, +b.dataset.i);
      b.addEventListener('click', ouvrir);
      b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrir(); } });
    });
    $('#formAdresse').addEventListener('submit', e => {
      e.preventDefault();
      const v = $('#champAdresse').value.trim();
      if (!v) return dessinerMemoire();
      const a = parseInt(v.replace(/^0x/i, ''), 16);
      if (Number.isFinite(a)) { $('#question').value = hex(a); chercher(hex(a)); dessinerMemoire(a); }
    });
    const t = vueMemoire.querySelector('.trouve');
    if (t) t.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  /* ------------------------------------------------------------ les appels système */
  const vueSvc = $('#vueSvc');
  function dessinerSvc() {
    let h = '<div class="mem-entete"><h2>Appels système</h2><p>' + D.svc.length + ' numéros documentés, de <code>0x01</code> à <code>0x7D</code>, et <code>0xFF</code>. Un jeu les appelle par l\'instruction <code>svc</code> ; le numéro est dans l\'instruction elle-même. ' + lien3dbrew(D.svc[0].url, 'SVC sur 3dbrew') + '</p>';
    h += '<label class="filtre-svc">Filtrer <input type="search" id="filtreSvc" placeholder="nom, numéro ou paramètre" spellcheck="false"></label>';
    h += '<label class="case"><input type="checkbox" id="seulArm11"> seulement ceux d\'un jeu (ARM11)</label></div>';
    h += '<table class="table-svc"><thead><tr><th>N°</th><th>Nom</th><th>Paramètres</th><th title="ARM11, ARM9 et TWL_FIRM">Où</th></tr></thead><tbody>';
    for (const s of D.svc) {
      const params = (s.sig.match(/\((.*)\)/) || ['', ''])[1];
      const ou = [s.arm11 ? 'ARM11' : '', s.arm9 ? 'ARM9' : '', s.twl ? 'TWL' : ''].filter(Boolean).join(', ');
      h += '<tr data-n="' + s.n + '" tabindex="0"><td><code>' + hex(s.n, 2) + '</code></td><td>' + echap(s.nom) + (s.note && /stub/i.test(s.note) ? ' <span class="marque-nl">bouchon</span>' : '') + '</td><td><code class="params">' + echap(params) + '</code></td><td>' + ou + '</td></tr>';
    }
    h += '</tbody></table>';
    vueSvc.innerHTML = h;
    const filtre = () => {
      const q = $('#filtreSvc').value.trim().toLowerCase().replace(/^svc\s*/, '');
      const a11 = $('#seulArm11').checked;
      vueSvc.querySelectorAll('tbody tr').forEach(tr => {
        const s = svcParNum[+tr.dataset.n];
        const num = hex(s.n, 2).toLowerCase();
        const ok = (!q || s.nom.toLowerCase().includes(q) || num === q || num === '0x' + q.replace(/^0x/, '').padStart(2, '0') || s.sig.toLowerCase().includes(q)) && (!a11 || s.arm11);
        tr.hidden = !ok;
      });
    };
    $('#filtreSvc').addEventListener('input', filtre);
    $('#seulArm11').addEventListener('change', filtre);
    vueSvc.querySelector('tbody').addEventListener('click', e => {
      const tr = e.target.closest('tr'); if (!tr) return;
      vueSvc.querySelectorAll('tr.choisie').forEach(x => x.classList.remove('choisie'));
      tr.classList.add('choisie');
      choisirSvc(+tr.dataset.n);
    });
    vueSvc.querySelector('tbody').addEventListener('keydown', e => {
      const tr = e.target.closest('tr');
      if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tr.click(); }
    });
  }

  /* ------------------------------------------------------------ vues */
  function montrerVue(v, adresse) {
    const avant = document.body.dataset.vue;
    document.body.dataset.vue = v;
    $('#vuePlan').hidden = v !== 'plan';
    vueMemoire.hidden = v !== 'memoire';
    vueSvc.hidden = v !== 'svc';
    document.querySelectorAll('.vue').forEach(b => b.setAttribute('aria-pressed', b.dataset.vue === v ? 'true' : 'false'));
    if (v === 'memoire' && (avant !== 'memoire' || adresse != null)) dessinerMemoire(adresse);
    if (v === 'svc' && !vueSvc.firstChild) dessinerSvc();
    if (v === 'plan' && avant !== 'plan' && avant) requestAnimationFrame(() => { if (!(vue.k > 0.05) || vue.aRefaire) { vue.aRefaire = false; ensemble(); } });
  }
  document.querySelectorAll('.vue').forEach(b => b.addEventListener('click', () => montrerVue(b.dataset.vue)));

  /* ------------------------------------------------------------ clavier et adresse */
  document.addEventListener('keydown', e => {
    const champ = e.target.closest('input, textarea');
    if (e.key === '/' && !champ) { e.preventDefault(); $('#question').focus(); $('#question').select(); return; }
    if (champ) { if (e.key === 'Escape') e.target.blur(); return; }
    if (document.body.dataset.vue !== 'plan') return;
    if (e.key === '0' || e.key === 'Home') { e.preventDefault(); ensemble(); }
    else if (e.key === '+' || e.key === '=') zoomer(1.4);
    else if (e.key === '-') zoomer(1 / 1.4);
    else if (e.key === 'Escape') { trouvesCourants = []; marquer(null, []); accueil(); memoriser(''); }
  });
  function memoriser(h) {
    try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch (err) { /* file:// sans historique */ }
  }
  function lireAdresse() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h) return false;
    if (h === 'jeu') { choisirJeu(); return true; }
    const [k, v] = [h.slice(0, h.indexOf('=')), h.slice(h.indexOf('=') + 1)];
    if (k === 's' && service[v]) { choisirStation(v); return true; }
    if (k === 'm' && module_[v]) { choisirModule(v); return true; }
    if (k === 'svc') { montrerVue('svc'); choisirSvc(parseInt(v, 16)); return true; }
    if (k === 'q') { $('#question').value = v; chercher(v); return true; }
    return false;
  }

  /* ------------------------------------------------------------ départ */
  calculer();
  dessiner();
  legende();
  document.body.dataset.vue = 'plan';
  ensemble();
  if (!lireAdresse()) accueil();
  window.addEventListener('resize', () => { if (document.body.dataset.vue === 'plan') ensemble(); else vue.aRefaire = true; });
  window.carte = { chercher, choisirStation, choisirModule, choisirJeu, choisirSvc, montrerVue, ensemble, vue, geo };
})();
