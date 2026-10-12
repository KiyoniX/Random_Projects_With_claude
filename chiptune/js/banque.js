(function () {
  'use strict';

  var P = window.Puce, C = window.Chiptune;
  var NOTE_OFF = P.NOTE_OFF;
  var DEMI_TONS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  var BATTERIE = { k: 10, s: 11, h: 12, o: 13 };     // lettres de la notation des percussions
  var NOTE_BATTERIE = 60;

  // ---------- Banque d'instruments ----------
  function sinus(parts) {
    var o = [], i, k, v, max = 0, brut = [];
    for (i = 0; i < 32; i++) {
      v = 0;
      for (k = 0; k < parts.length; k++) v += parts[k] * Math.sin(2 * Math.PI * (k + 1) * (i + 0.5) / 32);
      brut.push(v); max = Math.max(max, Math.abs(v));
    }
    for (i = 0; i < 32; i++) o.push(Math.max(0, Math.min(15, Math.round(7.5 + 7.5 * brut[i] / max))));
    return o;
  }
  function scie() { var o = [], i; for (i = 0; i < 32; i++) o.push(i >> 1); return o; }

  var BANQUE = [
    { nom: 'Carré franc', type: 0, rap: 2, a: 0, d: 6, s: 11, r: 4 },
    { nom: 'Carré nasal', type: 0, rap: 1, a: 0, d: 4, s: 12, r: 5, vibProf: 18, vibVit: 6, vibDelai: 14 },
    { nom: 'Pincé', type: 0, rap: 0, a: 0, d: 14, s: 0, r: 3 },
    { nom: 'Balayage', type: 0, rap: 2, rapSeq: [0, 1, 2, 3, 2, 1], rapVit: 3, a: 0, d: 8, s: 9, r: 6 },
    { nom: 'Accord majeur', type: 0, rap: 2, arp: [0, 4, 7], arpVit: 2, vol: 11, a: 0, d: 10, s: 5, r: 4 },
    { nom: 'Accord mineur', type: 0, rap: 2, arp: [0, 3, 7], arpVit: 2, vol: 11, a: 0, d: 10, s: 5, r: 4 },
    { nom: 'Accord septième', type: 0, rap: 1, arp: [0, 4, 7, 10], arpVit: 2, vol: 11, a: 0, d: 10, s: 5, r: 4 },
    { nom: 'Basse triangle', type: 1, a: 0, d: 0, s: 15, r: 2 },
    { nom: 'Flûte triangle', type: 1, a: 1, d: 0, s: 15, r: 6, vibProf: 14, vibVit: 5, vibDelai: 12 },
    { nom: 'Grosse caisse', type: 2, noteFixe: 34, chute: 32, chuteDuree: 5, env: 'pas', pas: [15, 15, 13, 10, 7, 4, 2, 0], r: 0 },
    { nom: 'Caisse claire', type: 2, noteFixe: 74, chute: 10, chuteDuree: 2, env: 'pas', pas: [15, 13, 11, 9, 7, 6, 5, 4, 3, 2, 1, 0], r: 0 },
    { nom: 'Charleston', type: 2, noteFixe: 98, env: 'pas', pas: [11, 6, 2, 0], r: 0 },
    { nom: 'Charleston ouvert', type: 2, noteFixe: 98, env: 'pas', pas: [10, 9, 8, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 0], r: 0 },
    { nom: 'Orgue', type: 3, onde: sinus([1, 0.5, 0, 0.3]), a: 1, d: 0, s: 15, r: 5, vibProf: 8, vibVit: 5, vibDelai: 16 },
    { nom: 'Basse en scie', type: 3, onde: scie(), a: 0, d: 6, s: 12, r: 3 },
    { nom: 'Tom', type: 1, chute: 12, chuteDuree: 8, a: 0, d: 16, s: 0, r: 2 },
    { nom: 'Cloche de métal', type: 2, court: true, a: 0, d: 30, s: 0, r: 10 },
    { nom: 'Caisse triangle', type: 1, noteFixe: 38, chute: 30, chuteDuree: 5, a: 0, d: 9, s: 0, r: 0 }
  ];
  P.banque = function () { return BANQUE.map(function (x) { return P.normInstr(x, false); }); };

  // ---------- Bruitages fournis ----------
  var BRUITAGES = [
    { nom: 'Saut', type: 0, rap: 1, note: 62, duree: 9, gliss: 95, vol: 12, a: 0, d: 12, s: 0, r: 2 },
    { nom: 'Pièce', type: 0, rap: 2, note: 83, duree: 22, arp: [0, 5], arpVit: 4, arpBoucle: false, a: 0, d: 24, s: 0, r: 4 },
    { nom: 'Coup', type: 2, note: 58, duree: 6, chute: 26, chuteDuree: 4, env: 'pas', pas: [15, 12, 8, 4, 2, 0], r: 0 },
    { nom: 'Explosion', type: 2, note: 52, duree: 50, gliss: -28, a: 0, d: 50, s: 0, r: 8 },
    { nom: 'Laser', type: 0, rap: 1, note: 90, duree: 13, gliss: -230, a: 0, d: 14, s: 0, r: 2 },
    { nom: 'Validation', type: 0, rap: 2, note: 72, duree: 14, arp: [0, 4, 7, 12], arpVit: 3, arpBoucle: false, a: 0, d: 6, s: 9, r: 8 },
    { nom: 'Erreur', type: 0, rap: 0, note: 50, duree: 16, arp: [0, 0, -5], arpVit: 5, arpBoucle: false, a: 0, d: 2, s: 12, r: 3 },
    { nom: 'Dégât', type: 2, court: true, note: 70, duree: 10, gliss: -160, a: 0, d: 10, s: 0, r: 2 },
    { nom: 'Bonus', type: 3, onde: sinus([1, 0, 0.4]), note: 67, duree: 30, arp: [0, 4, 7, 12, 16, 19], arpVit: 3, gliss: 12, a: 0, d: 30, s: 4, r: 10 },
    { nom: 'Curseur', type: 1, note: 84, duree: 3, a: 0, d: 4, s: 0, r: 1 }
  ];
  P.bruitagesFournis = function () { return BRUITAGES.map(function (x) { return P.normInstr(x, true); }); };

  // ---------- Hasard à graine ----------
  function hasard(graine) {
    var a = Math.imul((graine ^ 0x9E3779B9) >>> 0, 0x85EBCA6B) >>> 0;
    var f = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.entier = function (lo, hi) { return lo + Math.floor(f() * (hi - lo + 1)); };
    f.choix = function (t) { return t[Math.floor(f() * t.length)]; };
    return f;
  }
  P.hasard = hasard;

  // Un bruitage tiré au sort dans une famille (saut, pièce, coup, explosion, laser, validation, erreur).
  P.bruitAuHasard = function (famille, graine) {
    var h = hasard(graine == null ? (Date.now() ^ (Math.random() * 1e9)) : graine), b, n, i;
    famille = famille || h.choix(['saut', 'piece', 'coup', 'explosion', 'laser', 'validation', 'erreur']);
    if (famille === 'saut') b = { nom: 'Saut', type: 0, rap: h.entier(0, 2), note: h.entier(55, 70), gliss: h.entier(50, 150), d: h.entier(8, 16), s: 0, duree: h.entier(6, 12), vol: 12 };
    else if (famille === 'piece') b = { nom: 'Pièce', type: h.choix([0, 0, 1]), rap: h.entier(1, 2), note: h.entier(76, 90), arp: [0, h.choix([4, 5, 7, 12])], arpVit: h.entier(3, 6), arpBoucle: false, d: h.entier(16, 34), s: 0, duree: h.entier(14, 28), r: 4 };
    else if (famille === 'coup') b = { nom: 'Coup', type: 2, court: h() < 0.2, note: h.entier(48, 70), chute: h.entier(12, 36), chuteDuree: h.entier(2, 6), d: h.entier(4, 9), s: 0, duree: h.entier(4, 8) };
    else if (famille === 'explosion') b = { nom: 'Explosion', type: 2, note: h.entier(44, 60), gliss: -h.entier(10, 45), d: h.entier(30, 80), s: 0, duree: h.entier(30, 80), r: 8, vibProf: h() < 0.4 ? h.entier(60, 200) : 0, vibVit: h.entier(8, 18), vibDelai: 0 };
    else if (famille === 'laser') b = { nom: 'Laser', type: h.choix([0, 0, 3]), rap: h.entier(0, 2), note: h.entier(80, 98), gliss: -h.entier(120, 380), d: h.entier(8, 20), s: 0, duree: h.entier(8, 18), rapSeq: h() < 0.4 ? [0, 1, 2, 3] : [], rapVit: 2 };
    else if (famille === 'validation') {
      n = h.entier(3, 5); b = { nom: 'Validation', type: h.choix([0, 1, 3]), rap: 2, note: h.entier(64, 76), arp: [], arpVit: h.entier(2, 5), arpBoucle: false, d: 6, s: h.entier(7, 11), r: h.entier(5, 12), duree: 0 };
      for (i = 0; i < n; i++) b.arp.push([0, 4, 7, 12, 16, 19][i]);
      b.duree = n * b.arpVit + 4;
    } else b = { nom: 'Erreur', type: 0, rap: h.entier(0, 1), note: h.entier(42, 56), arp: [0, 0, -h.entier(1, 6)], arpVit: h.entier(4, 7), arpBoucle: false, d: 2, s: 12, r: 3, duree: h.entier(12, 20), vibProf: h() < 0.3 ? 40 : 0, vibVit: 14, vibDelai: 0 };
    return P.normInstr(b, true);
  };

  // Une variation légère du bruitage donné.
  P.bruitVarier = function (def, graine) {
    var h = hasard(graine == null ? (Date.now() ^ (Math.random() * 1e9)) : graine), b = P.copie(def);
    function v(champ, part, min) {
      var x = b[champ];
      if (!x) return;
      b[champ] = Math.round(x * (1 + (h() * 2 - 1) * part));
      if (min != null && Math.abs(b[champ]) < min) b[champ] = x;
    }
    b.note += h.entier(-3, 3);
    v('gliss', 0.3, 1); v('d', 0.3, 1); v('duree', 0.25, 2); v('chute', 0.3, 1); v('chuteDuree', 0.3, 1); v('r', 0.3); v('vibProf', 0.3);
    if (b.type === 0 && h() < 0.4) b.rap = h.entier(0, 3);
    return P.normInstr(b, true);
  };

  // ---------- Notation des morceaux fournis ----------
  // Un jeton par ligne : « . » rien, « = » relâche, « c#4 » ou un numéro MIDI pour une note,
  // « k s h o » pour la batterie ; suffixes « ^8 » (volume) et « !A47 » (effet).
  function piste(texte, instr, vol) {
    var jetons = texte.split(/\s+/), o = [], i, t, m, c, n;
    for (i = 0; i < jetons.length; i++) {
      t = jetons[i];
      if (!t || t === '|') continue;
      c = { n: 0, i: 0, v: 0, e: 0, p: 0 };
      if (t === '=') c.n = NOTE_OFF;
      else if (t !== '.') {
        m = /^([a-g]#?\d|\d+|[ksho])(?:\^([0-9a-f]))?(?:!([A-Z])([0-9a-f]{2}))?$/i.exec(t);
        if (!m) throw new Error('Jeton illisible : ' + t);
        n = m[1];
        if (BATTERIE[n]) { c.n = NOTE_BATTERIE; c.i = BATTERIE[n]; }
        else {
          c.n = /^\d+$/.test(n) ? parseInt(n, 10) : DEMI_TONS[n[0]] + (n[1] === '#' ? 1 : 0) + (parseInt(n.slice(-1), 10) + 1) * 12;
          c.i = instr || 1;
        }
        if (m[2]) c.v = parseInt(m[2], 16) + 1; else if (vol != null) c.v = vol + 1;
        if (m[3]) { c.e = m[3].charCodeAt(0); c.p = parseInt(m[4], 16); }
      }
      o.push(c);
    }
    return o;
  }
  // Décale d'une fondamentale les jetons numériques d'un patron.
  function rel(patron, racine) {
    return patron.replace(/(^|\s)(-?\d+)(?=[\s^!]|$)/g, function (tout, avant, n) { return avant + (racine + parseInt(n, 10)); });
  }
  function suite() {
    var o = [], i;
    for (i = 0; i < arguments.length; i++) o = o.concat(arguments[i]);
    return o;
  }
  function silence(n) { return piste(new Array(n + 1).join('. ')); }
  // Copie décalée et affaiblie d'une piste : l'écho des trackers.
  function echo(cells, retard, vol) {
    var o = silence(cells.length), i, j;
    for (i = 0; i < cells.length; i++) {
      if (!cells[i].n) continue;
      j = (i + retard) % cells.length;
      o[j] = { n: cells[i].n, i: cells[i].i, v: cells[i].n === NOTE_OFF ? 0 : vol + 1, e: 0, p: 0 };
    }
    return o;
  }
  P.alertesDemos = [];
  function motif(nom, pas, pistes) {
    var m = P.creerMotif(nom, pas), v, l, c;
    for (v = 0; v < 5; v++) {
      c = pistes[v] || [];
      if (c.length && c.length !== pas) P.alertesDemos.push(nom + ', voie ' + v + ' : ' + c.length + ' lignes au lieu de ' + pas);
      for (l = 0; l < pas && l < c.length; l++) {
        m.voies[v].n[l] = c[l].n; m.voies[v].i[l] = c[l].i; m.voies[v].v[l] = c[l].v; m.voies[v].e[l] = c[l].e; m.voies[v].p[l] = c[l].p;
      }
    }
    return m;
  }
  function projet(o) {
    var p = P.projetVide(), k;
    for (k in o) p[k] = o[k];
    return p;
  }

  // ---------- Premier niveau : do majeur, 140 à la noire ----------
  function demoNiveau() {
    var bat = 'k . h . s . h . k k h . s . h .', batFin = 'k . h . s . h . k k h . s s o .';
    var batterie = suite(piste(bat), piste(bat), piste(bat), piste(batFin));
    var bp = '0 . 12 . 0 . 12 . 0 . 12 . 7 . 12 .';
    function basse(r) { return piste(r.map(function (x) { return typeof x === 'string' ? x : rel(bp, x); }).join(' '), 8); }
    function coups(r, ins) { return piste(rel('. . 0 . . . 0 . . . 0 . . 0 . .', r), ins, 10); }
    var fg = rel('0 . 12 . 0 . 12 .', 41) + ' ' + rel('0 . 12 . 7 . 12 .', 43);
    var coupsFG = suite(piste(rel('. . 0 . . . 0 .', 53), 5, 10), piste(rel('. . 0 . . 0 . .', 55), 5, 10));
    var basseA = basse([36, 43, 45, fg]);
    var coupsA = suite(coups(60, 5), coups(55, 5), coups(57, 6), coupsFG);

    var melA = piste(
      'g4 . c5 . e5 . . d5 . . c5 . e5 . . . ' +
      'd5 . . b4 . . g4 . b4 . d5 . g5 . . . ' +
      'e5 . a5 . . g5 . e5 . . c5 . e5 . d5 . ' +
      'c5 . a4 . f4 . a4 . b4 . d5 . g5 . f5 .', 1);
    var melA2 = piste(
      'e5 . g5 . c6 . . b5 . . g5 . e5 . . . ' +
      'd5 . g5 . b5 . . a5 . . g5 . d5 . . . ' +
      'c5 . e5 . a5 . . g5 . . e5 . c5 . e5 . ' +
      'f5 . . e5 . . d5 . d5 . . c5 . . b4 .', 1);
    var contre = piste(
      'e4 . . . . . . . . . . . . . . . d4 . . . . . . . . . . . . . . . ' +
      'c4 . . . . . . . . . . . . . . . c4 . . . . . . . b3 . . . . . . .', 14, 9);
    var melB = piste(
      'a5 . . . f5 . a5 . c6 . . . a5 . . . ' +
      'b5 . . . g5 . b5 . d6 . . . b5 . . . ' +
      'g5 . . e5 . . b4 . e5 . g5 . b5 . g5 . ' +
      'a5 . . . . . e5 . a5 . . . . . . .', 2);
    var melB2 = piste(
      'a5 . c6 . a5 . f5 . a5 . c6 . a5 . f5 . ' +
      'b5 . d6 . b5 . g5 . b5 . d6 . b5 . g5 . ' +
      'c6 . . . g5 . . . e5 . . . g5 . . . ' +
      'c6 . . g5 . . e5 . c5 . . . = . . .', 2);
    var nappe = function (notes) { return piste(notes.map(function (n) { return rel('0 . . . . . . . . . . . . . . .', n); }).join(' '), 14, 9); };
    var intro = suite(silence(48), piste('. . . . . . . . g4 . a4 . b4 . d5 .', 3));
    var batIntro = suite(piste('h . . . h . . . h . . . h . h .'), piste('h . . . h . . . h . . . h . h .'), piste(bat), piste(batFin));

    return projet({
      titre: 'Premier niveau', tempo: 140, tonique: 0, gamme: 'majeure',
      motifs: [
        motif('Intro', 64, [intro, coupsA, basseA, batIntro, null]),
        motif('Thème', 64, [melA, coupsA, basseA, batterie, null]),
        motif('Thème 2', 64, [melA2, coupsA, basseA, batterie, contre]),
        motif('Pont', 64, [melB, suite(coups(53, 5), coups(55, 5), coups(52, 6), coups(57, 6)), basse([41, 43, 40, 45]), batterie, nappe([65, 67, 64, 69])]),
        motif('Pont 2', 64, [melB2, suite(coups(53, 5), coups(55, 5), coups(60, 5), coups(60, 5)), basse([41, 43, 36, 36]), batterie, nappe([69, 71, 67, 64])])
      ],
      arrangement: [{ motif: 0, fois: 1 }, { motif: 1, fois: 1 }, { motif: 2, fois: 1 }, { motif: 3, fois: 1 }, { motif: 4, fois: 1 }, { motif: 1, fois: 1 }, { motif: 2, fois: 1 }],
      boucle: 1
    });
  }

  // ---------- Crypte : la mineur, lent, arpèges égrenés et écho ----------
  function demoCrypte() {
    var mineur = '0 7 12 15 19 15 12 7 0 7 12 15 19 15 12 7', majeur = '0 7 12 16 19 16 12 7 0 7 12 16 19 16 12 7';
    function egrene(accords) { return piste(accords.map(function (a) { return rel(a[1] ? mineur : majeur, a[0]); }).join(' '), 3, 9); }
    function basse(r) { return piste(r.map(function (x) { return rel('0 . . . . . . . 0 . . . . . 12 .', x); }).join(' '), 8); }
    var bat = 'k . . . . . h . s . . . . . h .';
    var batterie = piste([bat, bat, bat, 'k . . . . . h . s . . . s . h h'].join(' '));
    var chant1 = piste(
      'e5 . . . . . . . a5 . . . . . g5 . ' +
      'f5 . . . . . . . c5 . . . . . . . ' +
      'e5 . . . . . . . g5 . . . . . e5 . ' +
      'd5 . . . . . . . b4 . . . d5 . . .', 14);
    var chant2 = piste(
      'f5 . . . . . e5 . d5 . . . . . a4 . ' +
      'c5 . . . . . b4 . a4 . . . . . . . ' +
      'b4 . . . . . . . e5 . . . . . . . ' +
      'g#5 . . . . . . . b5 . . . g#5 . e5 .', 14);
    var arpA = egrene([[45, 1], [41, 0], [48, 0], [43, 0]]), arpB = egrene([[50, 1], [45, 1], [40, 0], [40, 0]]);
    var basA = basse([45, 41, 36, 43]), basB = basse([38, 45, 40, 40]);
    var e1 = echo(chant1, 3, 4), e2 = echo(chant2, 3, 4), k;
    for (k = 0; k < 64; k++) { if (e1[k].n && e1[k].n !== NOTE_OFF) e1[k].i = 2; if (e2[k].n && e2[k].n !== NOTE_OFF) e2[k].i = 2; }
    return projet({
      titre: 'Crypte', tempo: 84, tonique: 9, gamme: 'mineure',
      motifs: [
        motif('Entrée', 64, [null, arpA, basA, piste(['. . . . . . h .', '. . . . . . h .', '. . . . . . h .', '. . . . . . h .', '. . . . . . h .', '. . . . . . h .', '. . . . . . h .', 's . . . s . h h'].join(' ')), null]),
        motif('Chant', 64, [e1, arpA, basA, batterie, chant1]),
        motif('Réponse', 64, [e2, arpB, basB, batterie, chant2])
      ],
      arrangement: [{ motif: 0, fois: 1 }, { motif: 1, fois: 2 }, { motif: 2, fois: 1 }, { motif: 1, fois: 1 }, { motif: 2, fois: 1 }],
      boucle: 1
    });
  }

  // ---------- Flânerie : blues de douze mesures en sol, croches balancées ----------
  function demoFlanerie() {
    var marche = '0 0 4 4 7 7 9 7', marcheRe = '0 0 7 7 10 10 7 7';
    function basse(r) { return piste(r.map(function (x) { return rel(x === 38 ? marcheRe : marche, x); }).join(' '), 8); }
    function coups(r) { return piste(r.map(function (x) { return rel('. . 0 . . . 0 .', x); }).join(' '), 7, 11); }
    function orgue(r) { return piste(r.map(function (x) { return rel('0 . . . . . . .', x); }).join(' '), 14, 7); }
    var bat = 'k h s h k k s h', batFin = 'k h s h k s s o';
    var batterie = piste([bat, bat, bat, batFin].join(' '));
    var A = [[43, 43, 43, 43], [48, 48, 43, 43], [38, 48, 43, 38]];
    var theme = [
      'd5 . b4 d5 . g5 . . | f5 . e5 d5 . b4 . . | d5 . b4 d5 . g5 . a5 | g5 . . . . . . .',
      'e5 . c5 e5 . g5 . . | a#5 . a5 g5 . e5 . . | d5 . b4 d5 . g5 . a5 | g5 . . . . . d5 .',
      'a5 . c6 . a5 . d5 . | g5 . a#5 . g5 . e5 . | d5 . b4 g4 . b4 d5 . | a4 . c5 . d5 . . .'
    ];
    var solo = [
      'g5 a#5 b5 d6 . b5 g5 . | f5 . d5 f5 . g5 . . | g5 a#5 b5 d6 . e6 d6 b5 | g5 . . . . . . .',
      'c6 . a#5 g5 . e5 g5 . | a#5 . g5 e5 . c5 . . | d5 e5 g5 b5 . g5 e5 d5 | g5 . . . . . . .',
      'd6 . c6 a5 . c6 a5 . | a#5 . g5 e5 . c5 e5 . | g5 . b5 d6 . b5 g5 . | d5 . f5 . d5 . . .'
    ];
    var motifs = [], i;
    for (i = 0; i < 3; i++) {
      motifs.push(motif('Thème ' + (i + 1), 32, [piste(theme[i], 2), coups(A[i].map(function (x) { return x + 12; })), basse(A[i]), batterie, orgue(A[i].map(function (x) { return x + 24; }))]));
    }
    for (i = 0; i < 3; i++) {
      motifs.push(motif('Chorus ' + (i + 1), 32, [piste(solo[i], 4), coups(A[i].map(function (x) { return x + 12; })), basse(A[i]), batterie, orgue(A[i].map(function (x) { return x + 31; }))]));
    }
    return projet({
      titre: 'Flânerie', tempo: 126, pasParTemps: 2, swing: 0.33, tonique: 7, gamme: 'mixolydien',
      motifs: motifs,
      arrangement: [0, 1, 2, 3, 4, 5].map(function (m) { return { motif: m, fois: 1 }; }),
      boucle: 0
    });
  }

  P.DEMOS = [
    { nom: 'Premier niveau', style: 'plateforme, do majeur', creer: demoNiveau },
    { nom: 'Crypte', style: 'donjon lent, la mineur', creer: demoCrypte },
    { nom: 'Flânerie', style: 'blues balancé, sol', creer: demoFlanerie }
  ];

  // ---------- Morceau aléatoire ----------
  var PROGRESSIONS = {
    majeure: [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 4, 3], [5, 3, 0, 4], [0, 3, 5, 4], [3, 4, 0, 5]],
    mineure: [[0, 5, 2, 6], [0, 3, 6, 2], [0, 6, 5, 6], [0, 5, 3, 4], [0, 2, 6, 3], [5, 6, 0, 0]]
  };
  var RYTHMES = [
    'x.x.x..x..x.x...', 'x..x..x.x.x.x...', 'x.xxx.x...x.x.x.', 'x...x.x.x..x..x.',
    'x.x...x.x.x...x.', 'x..x.x..x..x.x..', 'xx.x..x.x...x.x.', 'x.......x.x.x...'
  ];
  var BASSES = ['0 . 12 . 0 . 12 . 0 . 12 . 5 . 12 .', '0 . . 0 . . 0 . 0 . . 0 . 5 . .', '0 . 0 . 0 . 0 . 0 . 0 . 5 . 5 .', '0 . . . 12 . 0 . . 0 . . 12 . 5 .'];
  var BATTERIES = ['k . h . s . h . k k h . s . h .', 'k . h h s . h . k . h k s . h h', 'k . . h s . . h k k . h s . o .', 'k h h h s h h h k h k h s h h h'];

  // Génère un morceau complet et reproductible : même graine, même morceau.
  P.aleatoire = function (graine) {
    var h = hasard(graine), mode = h() < 0.55 ? 'majeure' : 'mineure', tonique = h.entier(0, 11);
    var deg = mode === 'majeure' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
    var progs = PROGRESSIONS[mode], pa = h.choix(progs), pb = h.choix(progs), basseP = h.choix(BASSES), batP = h.choix(BATTERIES);
    var lead = h.choix([1, 2, 4]), base = 60 + tonique - (tonique > 6 ? 12 : 0), essais = 0;
    while (pb === pa && essais++ < 8) pb = h.choix(progs);

    // demi-tons du degré d (éventuellement au-delà de l'octave) au-dessus de la tonique
    function hauteur(d) { return deg[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7); }
    function accord(d) { return [hauteur(d), hauteur(d + 2), hauteur(d + 4)]; }

    function section(prog, registre, rythmes) {
      var mel = [], bas = [], acc = [], pos = registre, m, k, a, r, d, t, cible, quinte, pb2;
      for (m = 0; m < 4; m++) {
        a = accord(prog[m]);
        quinte = a[2] - a[0];
        pb2 = basseP.replace(/\b5\b/g, String(quinte));
        bas = bas.concat(piste(rel(pb2, base - 24 + a[0] - (a[0] > 6 ? 12 : 0)), 8));
        // accords : un pincé avec l'effet d'arpège, tierce et quinte dans le paramètre
        t = ((a[1] - a[0]) << 4) | quinte;
        acc = acc.concat(piste(rel('. . 0 . . . 0 . . . 0 . . 0 . .', base - 12 + a[0]).replace(/(\d+)(?=\s|$)/g, '$1!A' + (t < 16 ? '0' : '') + t.toString(16)), 1, 7));
        r = rythmes[m];
        for (k = 0; k < 16; k++) {
          if (r[k] !== 'x') { mel.push('.'); continue; }
          if (k % 8 === 0) {
            // temps fort : la note de l'accord la plus proche
            cible = pos; d = 99;
            [0, 2, 4, 7, 9, 11, -3, -5].forEach(function (o) { var q = prog[m] + o; if (Math.abs(q - pos) < d) { d = Math.abs(q - pos); cible = q; } });
            pos = cible;
          } else pos += h.choix([-2, -1, -1, 1, 1, 2]);
          if (pos < registre - 4) pos += 2;
          if (pos > registre + 7) pos -= 2;
          mel.push(String(base + hauteur(pos)));
        }
      }
      return { mel: piste(mel.join(' '), lead), bas: bas, acc: acc };
    }

    var r1 = h.choix(RYTHMES), r2 = h.choix(RYTHMES), r3 = h.choix(RYTHMES), r4 = h.choix(RYTHMES);
    var sa = section(pa, 4, [r1, r2, r1, r3]), sb = section(pb, 7, [r4, r4, r2, 'x...x...x.......']);
    var bat = piste([batP, batP, batP, batP.slice(0, 16) + 'k . s s s . o .'].join(' '));
    var nappe = piste(pb.map(function (d) { return rel('0 . . . . . . . . . . . . . . .', base + hauteur(d + 2)); }).join(' '), 14, 8);
    return projet({
      titre: 'Graine ' + graine, tempo: h.entier(22, 38) * 4, tonique: tonique, gamme: mode,
      motifs: [
        motif('Intro', 64, [null, sa.acc, sa.bas, bat, null]),
        motif('Couplet', 64, [sa.mel, sa.acc, sa.bas, bat, null]),
        motif('Refrain', 64, [sb.mel, sb.acc, sb.bas, bat, nappe])
      ],
      arrangement: [{ motif: 0, fois: 1 }, { motif: 1, fois: 2 }, { motif: 2, fois: 1 }, { motif: 1, fois: 1 }, { motif: 2, fois: 1 }],
      boucle: 1
    });
  };
})();
