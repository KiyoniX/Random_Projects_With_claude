(function () {
  'use strict';

  var U = window.Usine;
  var DX = U.DX, DY = U.DY, FEN = U.FENETRE, TENUE = U.TENUE;
  var MACHINE = { four: 1, presse: 1, tour: 1, assem: 1 };
  var ORIENTE = { tapis: 1, fus: 1, four: 1, presse: 1, tour: 1, assem: 1 };   // reçoit par l'arrière et les côtés

  var RECS = {};
  U.RECETTES.forEach(function (r, i) {
    r.id = i; r.n = 0;
    for (var k in r.e) r.n += r.e[k];
    (RECS[r.m] = RECS[r.m] || []).push(r);
  });
  U.MACHINE = MACHINE;
  U.RECS = RECS;

  // ---------- Plan ----------
  // Un plan : c[case] = { k: pièce, d: direction, f: objet (filtre, source), p: période (source) } ou null.
  function fixes(niv) {
    if (niv._f) return niv._f;
    var f = new Array(niv.w * niv.h), x, y;
    (niv.murs || []).forEach(function (m) {
      for (y = m[1]; y < m[1] + m[3]; y++) for (x = m[0]; x < m[0] + m[2]; x++) f[y * niv.w + x] = 'mur';
    });
    niv.sources.forEach(function (s) { f[s.y * niv.w + s.x] = 'src'; });
    niv.sorties.forEach(function (s) { f[s.y * niv.w + s.x] = 'out'; });
    niv._f = f;
    return f;
  }

  function planVide(niv) {
    var c = [], i;
    for (i = 0; i < niv.w * niv.h; i++) c.push(null);
    return { w: niv.w, h: niv.h, c: c };
  }

  function posable(niv, x, y, k) {
    return x >= 0 && y >= 0 && x < niv.w && y < niv.h && !fixes(niv)[y * niv.w + x] && niv.pieces.indexOf(k) >= 0;
  }

  function poser(plan, niv, x, y, k, d, f, p) {
    if (!posable(niv, x, y, k)) return false;
    var i = y * plan.w + x, a = plan.c[i];
    var b = { k: k, d: d & 3, f: k === 'filtre' || k === 'src' ? f || 'mf' : null, p: k === 'src' ? p || 4 : 0 };
    if (a && a.k === b.k && a.d === b.d && a.f === b.f && a.p === b.p) return false;
    plan.c[i] = b;
    return true;
  }

  function oter(plan, x, y) {
    if (x < 0 || y < 0 || x >= plan.w || y >= plan.h || !plan.c[y * plan.w + x]) return false;
    plan.c[y * plan.w + x] = null;
    return true;
  }

  function cout(plan) {
    var n = 0, i;
    for (i = 0; i < plan.c.length; i++) if (plan.c[i]) n += U.PIECES[plan.c[i].k].cout;
    return n;
  }

  // Emprise : aire du plus petit rectangle qui contient toutes les pièces posées.
  function emprise(plan) {
    var x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, i, x, y;
    for (i = 0; i < plan.c.length; i++) {
      if (!plan.c[i]) continue;
      x = i % plan.w; y = (i - x) / plan.w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return x1 < 0 ? 0 : (x1 - x0 + 1) * (y1 - y0 + 1);
  }

  function coder(plan) {
    var l = [], i, c, a;
    for (i = 0; i < plan.c.length; i++) {
      c = plan.c[i];
      if (!c) continue;
      a = [i, c.k, c.d];
      if (c.f) a.push(c.f);
      if (c.p) a.push(c.p);
      l.push(a);
    }
    return JSON.stringify(l);
  }

  function decoder(niv, str) {
    var plan = planVide(niv), l;
    try { l = JSON.parse(str); } catch (e) { l = null; }
    if (!Array.isArray(l)) return plan;
    l.forEach(function (a) {
      if (!Array.isArray(a) || !U.PIECES[a[1]] || a[0] !== (a[0] | 0)) return;
      var f = U.OBJETS[a[3]] ? a[3] : null;
      poser(plan, niv, a[0] % niv.w, Math.floor(a[0] / niv.w), a[1], a[2] | 0, f, a[4] | 0);
    });
    return plan;
  }

  // ---------- Historique ----------
  // Chaque geste terminé empile l'état d'avant ; annuler et rétablir échangent des plans codés.
  function histo() { return { avant: [], apres: [] }; }

  function noter(h, avant, plan) {
    if (avant === coder(plan)) return false;
    h.avant.push(avant);
    if (h.avant.length > 300) h.avant.shift();
    h.apres.length = 0;
    return true;
  }

  function annuler(h, niv, plan) {
    if (!h.avant.length) return null;
    h.apres.push(coder(plan));
    return decoder(niv, h.avant.pop());
  }

  function retablir(h, niv, plan) {
    if (!h.apres.length) return null;
    h.avant.push(coder(plan));
    return decoder(niv, h.apres.pop());
  }

  // ---------- Construction ----------
  function entite(k, x, y, d, w) {
    return { k: k, x: x, y: y, i: y * w + x, d: d | 0, f: null, p: 0, seq: null, veut: null, fixe: false,
      it: null, it2: null, rr: 0, buf: {}, nb: 0, rec: null, t: 0, out: [], c: 0, n: 0, att: 0, etat: '',
      vers: [], lat: [], am: [null, null, null], recu: {}, fen: {}, taux: {}, vu: 0 };
  }

  // Par où la pièce n reçoit-elle un objet qui avance dans la direction dir ? Voie 0 ou 1, ou -1.
  function prise(n, dir) {
    switch (n.k) {
      case 'sep': case 'filtre': return dir === n.d ? 0 : -1;
      case 'pont': return dir === n.d ? 0 : dir === ((n.d + 1) & 3) ? 1 : -1;
      case 'out': case 'broyeur': return 0;
      case 'src': return -1;
      default: return dir !== ((n.d + 2) & 3) ? 0 : -1;
    }
  }

  function bouches(e) {
    switch (e.k) {
      case 'sep': case 'filtre': return [[e.d, 0], [(e.d + 3) & 3, 0], [(e.d + 1) & 3, 0]];
      case 'pont': return [[e.d, 0], [(e.d + 1) & 3, 1]];
      case 'out': case 'broyeur': return [];
      default: return [[e.d, 0]];
    }
  }

  function creer(niv, plan) {
    var w = niv.w, h = niv.h, i, e;
    var S = { niv: niv, w: w, h: h, pas: 0, cases: new Array(w * h), ents: [], ordre: [], anims: [], sorties: [], besoins: [],
      crees: 0, livres: 0, detruits: 0, consommes: 0, produits: 0, lances: [], finis: [],
      debit: 0, stable: 0, tenue: 0, amorce: false, valide: false, cout: cout(plan), emprise: emprise(plan) };
    for (i = 0; i < U.RECETTES.length; i++) { S.lances.push(0); S.finis.push(0); }

    niv.sources.forEach(function (s) {
      e = entite('src', s.x, s.y, s.d, w);
      e.seq = s.o; e.p = s.p; e.c = s.p; e.fixe = true;
      S.cases[e.i] = e;
    });
    niv.sorties.forEach(function (s) {
      var k;
      e = entite('out', s.x, s.y, 0, w);
      e.veut = s.veut || null; e.fixe = true; e.benne = !s.veut;
      S.cases[e.i] = e;
      for (k in e.veut) S.besoins.push({ o: e, k: k, c: e.veut[k], h: [], vu: false });
    });
    for (i = 0; i < plan.c.length; i++) {
      var c = plan.c[i];
      if (!c || S.cases[i]) continue;
      e = entite(c.k, i % w, Math.floor(i / w), c.d, w);
      e.f = c.f;
      if (c.k === 'src') { e.seq = [c.f]; e.p = c.p; e.c = c.p; }
      S.cases[i] = e;
    }
    for (i = 0; i < w * h; i++) if (S.cases[i]) { S.ents.push(S.cases[i]); if (S.cases[i].k === 'out') S.sorties.push(S.cases[i]); }

    S.ents.forEach(function (a) {
      bouches(a).forEach(function (b) {
        var x = a.x + DX[b[0]], y = a.y + DY[b[0]], n, v, l;
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        n = S.cases[y * w + x];
        if (!n) return;
        v = prise(n, b[0]);
        if (v < 0) return;
        // c : côté d'arrivée chez le receveur. 0 arrière, 1 gauche, 2 droite.
        l = { e: a, n: n, d: b[0], de: b[1], v: v, c: b[0] === n.d ? 0 : b[0] === ((n.d + 1) & 3) ? 1 : 2 };
        a.vers.push(l);
        if (a.k === 'filtre' && b[0] !== a.d) a.lat.push(l);
        if (ORIENTE[n.k]) n.am[l.c] = l;
      });
    });

    // Ordre de traitement : l'aval avant l'amont, pour qu'une file pleine avance d'un bloc.
    // Les machines servent de racines : une boucle est alors coupée à l'entrée d'une machine,
    // là où le stock d'entrée absorbe le décalage.
    function visiter(a, voie) {
      var bit = 1 << voie, j;
      if (a.vu & bit) return;
      a.vu |= bit;
      for (j = 0; j < a.vers.length; j++) if (a.vers[j].de === voie) visiter(a.vers[j].n, a.vers[j].v);
      S.ordre.push(a, voie);
    }
    S.ents.forEach(function (a) { if (MACHINE[a.k]) visiter(a, 0); });
    S.ents.forEach(function (a) { visiter(a, 0); if (a.k === 'pont') visiter(a, 1); });
    S.besoins.forEach(function (b) { for (i = 0; i < TENUE; i++) b.h.push(0); });
    return S;
  }

  // ---------- Simulation ----------
  function tete(e, voie) {
    if (MACHINE[e.k]) return e.out.length ? e.out[0] : null;
    return voie ? e.it2 : e.it;
  }

  // Le lien l porte-t-il un objet arrivé avant ce pas et qui veut passer par là ?
  function pret(S, l) {
    var it = tete(l.e, l.de);
    if (!it || it.m === S.pas) return false;
    if (l.e.k === 'filtre') return (it.k === l.e.f) === (l.d === l.e.d);
    return true;
  }

  // Une machine accepte un objet si son stock, avec lui, reste une partie d'une de ses recettes.
  function place(n, k) {
    var recs = RECS[n.k], a = (n.buf[k] || 0) + 1, i, r, b, ok;
    for (i = 0; i < recs.length; i++) {
      r = recs[i];
      if (!r.e[k] || a > r.e[k]) continue;
      ok = true;
      for (b in n.buf) if (n.buf[b] > (r.e[b] || 0)) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }

  function accepte(S, l, k) {
    var n = l.n, j;
    switch (n.k) {
      case 'tapis':
        if (n.it) return false;
        for (j = 0; j < l.c; j++) if (n.am[j] && pret(S, n.am[j])) return false;
        return true;
      case 'fus':
        if (n.it) return false;
        for (j = n.rr; j !== l.c; j = (j + 1) % 3) if (n.am[j] && pret(S, n.am[j])) return false;
        return true;
      case 'sep': case 'filtre': return !n.it;
      case 'pont': return l.v ? !n.it2 : !n.it;
      case 'out': return !n.veut || n.veut[k] !== undefined;
      case 'broyeur': return true;
      default: return place(n, k);
    }
  }

  function passer(S, l, it) {
    var e = l.e, n = l.n, i;
    if (MACHINE[e.k]) e.out.shift(); else if (l.de) e.it2 = null; else e.it = null;
    it.m = S.pas; it.fx = e.x; it.fy = e.y;
    it.h = (e.k === 'pont' && !l.de) || (n.k === 'pont' && !l.v);   // passe sur le tablier d'un pont
    switch (n.k) {
      case 'tapis': case 'sep': case 'filtre': n.it = it; return;
      case 'fus': n.it = it; n.rr = (l.c + 1) % 3; return;
      case 'pont': if (l.v) n.it2 = it; else n.it = it; return;
      case 'out':
        S.livres++;
        n.recu[it.k] = (n.recu[it.k] || 0) + 1;
        if (!n.fen[it.k]) { n.fen[it.k] = []; for (i = 0; i < FEN; i++) n.fen[it.k].push(0); n.taux[it.k] = 0; }
        n.fen[it.k][S.pas % FEN]++; n.taux[it.k]++;
        break;
      case 'broyeur': S.detruits++; break;
      default: n.buf[it.k] = (n.buf[it.k] || 0) + 1; n.nb++;
    }
    S.anims.push({ k: it.k, fx: e.x, fy: e.y, x: n.x, y: n.y });
  }

  function bouger(S, e, voie) {
    var it = tete(e, voie), v, n, j, l;
    if (!it || it.m === S.pas) return;
    if (e.k === 'sep') {
      v = e.vers; n = v.length;
      for (j = 0; j < n; j++) {
        l = v[(e.rr + j) % n];
        if (accepte(S, l, it.k)) { e.rr = (e.rr + j + 1) % n; passer(S, l, it); return; }
      }
      return;
    }
    if (e.k === 'filtre' && it.k !== e.f) {
      v = e.lat; n = v.length;
      for (j = 0; j < n; j++) {
        l = v[(e.rr + j) % n];
        if (accepte(S, l, it.k)) { e.rr = (e.rr + j + 1) % n; passer(S, l, it); return; }
      }
      return;
    }
    v = e.vers;
    for (j = 0; j < v.length; j++) {
      l = v[j];
      if (l.de !== voie || (e.k === 'filtre' && l.d !== e.d)) continue;
      if (accepte(S, l, it.k)) { passer(S, l, it); return; }
    }
  }

  function complete(e) {
    var recs = RECS[e.k], i, r, k, ok;
    for (i = 0; i < recs.length; i++) {
      r = recs[i];
      if (r.n !== e.nb) continue;
      ok = true;
      for (k in r.e) if (e.buf[k] !== r.e[k]) { ok = false; break; }
      if (ok) return r;
    }
    return null;
  }

  function avancer(S) {
    var ents = S.ents, i, j, e, r, k, o, idx, d, t, v, ok, c0;
    S.pas++;
    S.anims = [];
    idx = S.pas % FEN;
    for (i = 0; i < S.sorties.length; i++) {
      o = S.sorties[i];
      for (k in o.fen) { o.taux[k] -= o.fen[k][idx]; o.fen[k][idx] = 0; }
    }

    // Sources et machines.
    for (i = 0; i < ents.length; i++) {
      e = ents[i];
      if (e.k === 'src') {
        if (e.c < e.p) e.c++;
        if (e.c >= e.p && !e.it) {
          e.it = { k: e.seq[e.n], m: -1, fx: e.x, fy: e.y, h: false };
          e.n = (e.n + 1) % e.seq.length; e.c = 0;
          S.crees++;
        }
      } else if (MACHINE[e.k]) {
        if (e.rec) {
          if (e.t > 0) e.t--;
          if (e.t === 0 && !e.out.length) {
            r = e.rec;
            for (j = 0; j < r.s.length; j++) e.out.push({ k: r.s[j], m: -1, fx: e.x, fy: e.y, h: false });
            S.produits += r.s.length; S.finis[r.id]++;
            e.rec = null;
          }
        }
        if (!e.rec && e.nb) {
          r = complete(e);
          if (r) {
            e.buf = {}; e.nb = 0;
            e.rec = r; e.t = r.t;
            S.consommes += r.n; S.lances[r.id]++;
          }
        }
      }
    }

    // Déplacements, un par nœud, dans l'ordre aval → amont.
    for (i = 0; i < S.ordre.length; i += 2) bouger(S, S.ordre[i], S.ordre[i + 1]);

    // États, pour le diagnostic.
    for (i = 0; i < ents.length; i++) {
      e = ents[i];
      if (e.k === 'src') e.att = e.it ? e.att + 1 : 0;
      else if (MACHINE[e.k]) {
        if (e.rec && e.t > 0) { e.etat = 'marche'; e.att = 0; }
        else { e.etat = e.out.length || e.rec ? 'bloquee' : 'affamee'; e.att++; }
      }
    }

    // Mesure. Le débit d'un besoin est ce qu'il a reçu sur la fenêtre. Il est tenu tant qu'il ne passe pas
    // à plus d'une unité sous la cible, à condition de l'avoir atteinte : une cadence juste, mais dont la
    // période ne tombe pas rond dans la fenêtre, oscille d'une unité sans démériter.
    if (S.besoins.length) {
      d = Infinity; ok = true; c0 = S.besoins[0].c; idx = S.pas % TENUE;
      for (i = 0; i < S.besoins.length; i++) {
        o = S.besoins[i];
        t = o.o.taux[o.k] || 0;
        o.h[idx] = t;
        if (t < o.c - 1) ok = false;
        v = Math.floor(t * c0 / o.c);
        if (v < d) d = v;
      }
      S.debit = d;
      S.tenue = ok ? S.tenue + 1 : 0;
      S.amorce = true;
      for (i = 0; i < S.besoins.length; i++) {
        o = S.besoins[i];
        if (!ok) o.vu = false; else if (o.h[idx] >= o.c) o.vu = true;
        if (!o.vu) S.amorce = false;
      }
      S.valide = S.amorce && S.tenue >= TENUE;
      S.stable = 0;
      if (S.valide) {
        d = Infinity;
        for (i = 0; i < S.besoins.length; i++) {
          o = S.besoins[i]; t = Infinity; v = 0;
          for (j = 0; j < TENUE; j++) { if (o.h[j] < t) t = o.h[j]; if (o.h[j] > v) v = o.h[j]; }
          v = Math.floor(Math.min(v, t + 1) * c0 / o.c);
          if (v < d) d = v;
        }
        S.stable = d;
      }
    }
  }

  // ---------- Score ----------
  function tient(p, r) {
    return (p.debit === undefined || r.debit >= p.debit) && (p.cout === undefined || r.cout <= p.cout) &&
      (p.emprise === undefined || r.emprise <= p.emprise);
  }

  function resultat(S) {
    var r = { valide: S.valide, debit: S.stable, cout: S.cout, emprise: S.emprise, etoiles: 0 }, p = S.niv.paliers;
    if (!r.valide) return r;
    r.etoiles = 1;
    if (p[0] && tient(p[0], r)) { r.etoiles = 2; if (p[1] && tient(p[1], r)) r.etoiles = 3; }
    return r;
  }

  // ---------- Contrôle ----------
  function enCirculation(S) {
    var n = 0, i, e;
    for (i = 0; i < S.ents.length; i++) {
      e = S.ents[i];
      n += (e.it ? 1 : 0) + (e.it2 ? 1 : 0) + e.out.length + e.nb;
    }
    return n;
  }

  function empreinte(S) {
    var l = [S.pas, S.crees, S.livres, S.detruits, S.consommes, S.produits, S.debit, S.tenue, S.stable], i, e;
    for (i = 0; i < S.ents.length; i++) {
      e = S.ents[i];
      l.push(e.i + ':' + (e.it ? e.it.k : '') + ',' + (e.it2 ? e.it2.k : '') + ',' + e.rr + ',' + JSON.stringify(e.buf) + ',' +
        (e.rec ? e.rec.id : '') + ',' + e.t + ',' + e.out.map(function (o) { return o.k; }).join('') + ',' + e.c + ',' + e.n + ',' +
        e.att + ',' + JSON.stringify(e.recu));
    }
    return l.join('|');
  }

  U.fixes = fixes; U.planVide = planVide; U.posable = posable; U.poser = poser; U.oter = oter;
  U.cout = cout; U.emprise = emprise; U.coder = coder; U.decoder = decoder;
  U.histo = histo; U.noter = noter; U.annuler = annuler; U.retablir = retablir;
  U.creer = creer; U.avancer = avancer; U.resultat = resultat; U.tient = tient;
  U.enCirculation = enCirculation; U.empreinte = empreinte;
})();
