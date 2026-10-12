(function () {
  'use strict';

  var C = window.Chiptune;
  var VOIES = C.VOIES, NOTE_OFF = C.NOTE_OFF;
  var NOTE_MIN = 12, NOTE_MAX = 119;      // do0 à si8
  var PAS_MAX = 128;
  var HIST_MAX = 200;
  var FUSION_MS = 900;                    // les réglages rapprochés d'un même curseur ne font qu'une étape

  var P = window.Puce = {
    VOIES: VOIES, NOTE_OFF: NOTE_OFF, NOTE_MIN: NOTE_MIN, NOTE_MAX: NOTE_MAX,
    NOMS_VOIES: ['Carré 1', 'Carré 2', 'Triangle', 'Bruit', 'Onde'],
    NOMS_TYPES: ['Carré', 'Triangle', 'Bruit', 'Onde'],
    NOTES: ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'],
    NOTES_FR: ['do', 'do♯', 'ré', 'ré♯', 'mi', 'fa', 'fa♯', 'sol', 'sol♯', 'la', 'la♯', 'si'],
    GAMMES: [
      { id: 'majeure', nom: 'majeur', deg: [0, 2, 4, 5, 7, 9, 11] },
      { id: 'mineure', nom: 'mineur', deg: [0, 2, 3, 5, 7, 8, 10] },
      { id: 'harmonique', nom: 'mineur harmonique', deg: [0, 2, 3, 5, 7, 8, 11] },
      { id: 'dorien', nom: 'dorien', deg: [0, 2, 3, 5, 7, 9, 10] },
      { id: 'mixolydien', nom: 'mixolydien', deg: [0, 2, 4, 5, 7, 9, 10] },
      { id: 'phrygien', nom: 'phrygien', deg: [0, 1, 3, 5, 7, 8, 10] },
      { id: 'penta-maj', nom: 'pentatonique majeur', deg: [0, 2, 4, 7, 9] },
      { id: 'penta-min', nom: 'pentatonique mineur', deg: [0, 3, 5, 7, 10] },
      { id: 'blues', nom: 'blues', deg: [0, 3, 5, 6, 7, 10] },
      { id: 'chromatique', nom: 'chromatique', deg: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }
    ],
    EFFETS: {
      A: 'arpège : xy = deux intervalles en demi-tons',
      M: 'glissement montant : xx centièmes par tic',
      D: 'glissement descendant : xx centièmes par tic',
      P: 'portamento vers la note : xx = vitesse',
      V: 'vibrato : x = vitesse, y = profondeur',
      R: 'rapport cyclique : 00 à 03',
      C: 'coupe la note après xx tics'
    },
    projet: null,
    cur: { ordre: 0, motif: 0, voie: 0, ligne: 0, col: 0 },
    sel: null,              // { v0, l0, v1, l1 } : ancre puis tête
    presse: null,
    octave: 4, pasEdition: 1, instr: 1, bruit: 0,
    ecouteurs: []
  };

  function borne(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function entier(v, a, b, d) { v = Math.round(Number(v)); return isFinite(v) ? borne(v, a, b) : d; }
  function copie(o) { return JSON.parse(JSON.stringify(o)); }
  P.borne = borne; P.copie = copie;

  // ---------- Notes et gammes ----------
  P.nomNote = function (n) {
    if (n === NOTE_OFF) return '===';
    if (!n) return '···';
    return P.NOTES[n % 12] + (Math.floor(n / 12) - 1);
  };
  P.nomNoteFr = function (n) { return P.NOTES_FR[n % 12] + ' ' + (Math.floor(n / 12) - 1); };
  P.frequence = function (n) { return 440 * Math.pow(2, (n - 69) / 12); };
  P.gamme = function () {
    var id = P.projet.gamme, i;
    for (i = 0; i < P.GAMMES.length; i++) if (P.GAMMES[i].id === id) return P.GAMMES[i];
    return P.GAMMES[0];
  };
  P.dansGamme = function (n) {
    return P.gamme().deg.indexOf(((n - P.projet.tonique) % 12 + 12) % 12) >= 0;
  };
  // Ramène une note sur la gamme : la plus proche, vers le bas en cas d'égalité.
  P.contraindre = function (n) {
    var d;
    for (d = 0; d < 7; d++) {
      if (P.dansGamme(n - d)) return n - d;
      if (P.dansGamme(n + d)) return n + d;
    }
    return n;
  };

  // ---------- Projet ----------
  function creerVoie(pas) {
    var z = function () { var t = [], i; for (i = 0; i < pas; i++) t.push(0); return t; };
    return { n: z(), i: z(), v: z(), e: z(), p: z() };
  }
  function creerMotif(nom, pas) {
    var m = { nom: nom, pas: pas, voies: [] }, i;
    for (i = 0; i < VOIES; i++) m.voies.push(creerVoie(pas));
    return m;
  }
  P.creerMotif = creerMotif;

  P.instrDefaut = function (type) {
    return {
      nom: 'Instrument', type: type || 0, vol: 15, env: 'adsr', a: 0, d: 8, s: 10, r: 4,
      pas: [15, 13, 11, 9, 7, 5, 3, 1, 0], pasBoucle: -1,
      rap: 2, rapSeq: [], rapVit: 2, rapBoucle: true,
      arp: [], arpVit: 1, arpBoucle: true,
      vibProf: 0, vibVit: 6, vibDelai: 8, gliss: 0, chute: 0, chuteDuree: 4,
      court: false, noteFixe: 0,
      onde: [8, 10, 12, 14, 15, 15, 14, 12, 10, 8, 6, 4, 2, 1, 0, 0, 1, 2, 4, 5, 7, 9, 11, 13, 13, 11, 9, 7, 5, 3, 2, 4]
    };
  };

  function liste(t, max, a, b, d) {
    var o = [], i;
    if (!Array.isArray(t)) return o;
    for (i = 0; i < t.length && i < max; i++) o.push(entier(t[i], a, b, d));
    return o;
  }

  function normInstr(x, bruitage) {
    var d = P.instrDefaut(0), o = {};
    x = x || {};
    o.nom = String(x.nom == null ? d.nom : x.nom).slice(0, 24);
    o.type = entier(x.type, 0, 3, 0);
    o.vol = entier(x.vol, 0, 15, 15);
    o.env = x.env === 'pas' ? 'pas' : 'adsr';
    o.a = entier(x.a, 0, 120, 0); o.d = entier(x.d, 0, 240, 8); o.s = entier(x.s, 0, 15, 10); o.r = entier(x.r, 0, 240, 4);
    o.pas = liste(x.pas, 64, 0, 15, 0); if (!o.pas.length) o.pas = d.pas;
    o.pasBoucle = entier(x.pasBoucle, -1, o.pas.length - 1, -1);
    o.rap = entier(x.rap, 0, 3, 2);
    o.rapSeq = liste(x.rapSeq, 32, 0, 3, 2); o.rapVit = entier(x.rapVit, 1, 30, 2); o.rapBoucle = x.rapBoucle !== false;
    o.arp = liste(x.arp, 16, -24, 24, 0); o.arpVit = entier(x.arpVit, 1, 30, 1); o.arpBoucle = x.arpBoucle !== false;
    o.vibProf = entier(x.vibProf, 0, 200, 0); o.vibVit = entier(x.vibVit, 1, 20, 6); o.vibDelai = entier(x.vibDelai, 0, 120, 8);
    o.gliss = entier(x.gliss, -400, 400, 0);
    o.chute = entier(x.chute, -48, 48, 0); o.chuteDuree = entier(x.chuteDuree, 1, 120, 4);
    o.court = !!x.court;
    o.noteFixe = entier(x.noteFixe, 0, NOTE_MAX, 0);
    o.onde = liste(x.onde, 32, 0, 15, 8); if (o.onde.length !== 32) o.onde = d.onde;
    if (bruitage) { o.note = entier(x.note, NOTE_MIN, NOTE_MAX, 72); o.duree = entier(x.duree, 1, 180, 10); }
    return o;
  }
  P.normInstr = normInstr;

  function normVoie(x, pas) {
    var o = creerVoie(pas), k, i, v;
    x = x || {};
    for (i = 0; i < pas; i++) {
      v = x.n ? x.n[i] : 0;
      o.n[i] = v === NOTE_OFF ? NOTE_OFF : (v ? entier(v, NOTE_MIN, NOTE_MAX, 0) : 0);
      o.i[i] = x.i ? entier(x.i[i], 0, 99, 0) : 0;
      o.v[i] = x.v ? entier(x.v[i], 0, 16, 0) : 0;
      k = x.e ? entier(x.e[i], 0, 90, 0) : 0;
      o.e[i] = k && P.EFFETS[String.fromCharCode(k)] ? k : 0;
      o.p[i] = x.p ? entier(x.p[i], 0, 255, 0) : 0;
    }
    return o;
  }

  // Valide un projet lu depuis un fichier et le complète ; lève une erreur lisible sinon.
  P.normaliser = function (x) {
    var o = {}, i, m, pas;
    if (!x || typeof x !== 'object' || x.format !== C.FORMAT) throw new Error('Ce fichier n\'est pas un projet de La Puce à l\'oreille.');
    if (!Array.isArray(x.motifs) || !x.motifs.length) throw new Error('Ce projet ne contient aucun motif.');
    o.format = C.FORMAT; o.version = 1;
    o.titre = String(x.titre || 'Sans titre').slice(0, 40);
    o.tempo = entier(x.tempo, 40, 300, 120);
    o.pasParTemps = entier(x.pasParTemps, 1, 8, 4);
    o.swing = borne(Math.round((Number(x.swing) || 0) * 100) / 100, 0, 0.6);
    o.tonique = entier(x.tonique, 0, 11, 0);
    o.gamme = String(x.gamme || 'majeure');
    o.contrainte = !!x.contrainte;
    o.volume = borne(Number(x.volume) || 1, 0.1, 1);
    o.instruments = (Array.isArray(x.instruments) ? x.instruments : []).slice(0, 99).map(function (q) { return normInstr(q, false); });
    if (!o.instruments.length) o.instruments.push(P.instrDefaut(0));
    o.motifs = [];
    for (i = 0; i < x.motifs.length && i < 99; i++) {
      m = x.motifs[i] || {};
      pas = entier(m.pas, 1, PAS_MAX, 32);
      o.motifs.push({ nom: String(m.nom || 'Motif').slice(0, 12), pas: pas, voies: [0, 1, 2, 3, 4].map(function (v) { return normVoie(m.voies && m.voies[v], pas); }) });
    }
    o.arrangement = (Array.isArray(x.arrangement) ? x.arrangement : []).slice(0, 256).map(function (a) {
      return { motif: entier(a && a.motif, 0, o.motifs.length - 1, 0), fois: entier(a && a.fois, 1, 16, 1) };
    });
    if (!o.arrangement.length) o.arrangement.push({ motif: 0, fois: 1 });
    o.boucle = entier(x.boucle, 0, o.arrangement.length - 1, 0);
    o.bruitages = (Array.isArray(x.bruitages) ? x.bruitages : []).slice(0, 64).map(function (q) { return normInstr(q, true); });
    return o;
  };

  P.projetVide = function () {
    return {
      format: C.FORMAT, version: 1, titre: 'Sans titre', tempo: 120, pasParTemps: 4, swing: 0,
      tonique: 0, gamme: 'majeure', contrainte: false, volume: 1,
      instruments: P.banque ? P.banque() : [P.instrDefaut(0)],
      motifs: [creerMotif('Motif 1', 32)],
      arrangement: [{ motif: 0, fois: 1 }], boucle: 0,
      bruitages: P.bruitagesFournis ? P.bruitagesFournis() : []
    };
  };

  P.ouvrir = function (x) {
    P.projet = P.normaliser(x);
    hist.pile = []; hist.refaire = []; hist.cle = '';
    P.cur = { ordre: 0, motif: P.projet.arrangement[0].motif, voie: 0, ligne: 0, col: 0 };
    P.sel = null; P.instr = 1; P.bruit = 0;
    signaler('ouvrir');
  };
  P.serialiser = function () { return JSON.stringify(P.projet); };

  function signaler(quoi) {
    for (var i = 0; i < P.ecouteurs.length; i++) P.ecouteurs[i](quoi);
  }
  P.signaler = signaler;
  P.ecouter = function (f) { P.ecouteurs.push(f); };

  // ---------- Historique ----------
  // Un état est une copie légère du projet : motifs, instruments et bruitages sont partagés et figés,
  // et ne sont dupliqués que lorsqu'une opération les modifie.
  var hist = { pile: [], refaire: [], cle: '', temps: 0 };
  var figes = new WeakSet();

  function etat() {
    var p = P.projet, e = {}, k;
    for (k in p) e[k] = p[k];
    e.instruments = p.instruments.slice(); e.motifs = p.motifs.slice(); e.bruitages = p.bruitages.slice();
    e.arrangement = copie(p.arrangement);
    e.instruments.forEach(function (x) { figes.add(x); });
    e.motifs.forEach(function (x) { figes.add(x); });
    e.bruitages.forEach(function (x) { figes.add(x); });
    return { p: e, cur: copie(P.cur), instr: P.instr, bruit: P.bruit };
  }
  function restaurer(e) {
    var p = {}, k;
    for (k in e.p) p[k] = e.p[k];
    p.instruments = e.p.instruments.slice(); p.motifs = e.p.motifs.slice(); p.bruitages = e.p.bruitages.slice();
    p.arrangement = copie(e.p.arrangement);
    P.projet = p; P.cur = copie(e.cur); P.instr = e.instr; P.bruit = e.bruit; P.sel = null;
    recadrer();
  }

  // À appeler avant de modifier le projet. cle : les opérations de même clé rapprochées fusionnent.
  P.op = function (libelle, cle) {
    var t = Date.now();
    if (cle && cle === hist.cle && t - hist.temps < FUSION_MS) { hist.temps = t; return; }
    hist.pile.push({ libelle: libelle, e: etat() });
    if (hist.pile.length > HIST_MAX) hist.pile.shift();
    hist.refaire = [];
    hist.cle = cle || ''; hist.temps = t;
  };
  P.annuler = function () {
    var h = hist.pile.pop();
    if (!h) return '';
    hist.refaire.push({ libelle: h.libelle, e: etat() });
    restaurer(h.e); hist.cle = '';
    signaler('annuler');
    return h.libelle;
  };
  P.retablir = function () {
    var h = hist.refaire.pop();
    if (!h) return '';
    hist.pile.push({ libelle: h.libelle, e: etat() });
    restaurer(h.e); hist.cle = '';
    signaler('retablir');
    return h.libelle;
  };
  P.histTailles = function () { return [hist.pile.length, hist.refaire.length]; };

  function ecrire(tab, i) {
    if (figes.has(tab[i])) tab[i] = copie(tab[i]);
    return tab[i];
  }
  P.motifE = function (i) { return ecrire(P.projet.motifs, i == null ? P.cur.motif : i); };
  P.instrE = function (i) { return ecrire(P.projet.instruments, i); };
  P.bruitE = function (i) { return ecrire(P.projet.bruitages, i); };
  P.motif = function () { return P.projet.motifs[P.cur.motif]; };

  function recadrer() {
    var p = P.projet, c = P.cur;
    c.ordre = borne(c.ordre, 0, p.arrangement.length - 1);
    c.motif = borne(c.motif, 0, p.motifs.length - 1);
    c.ligne = borne(c.ligne, 0, p.motifs[c.motif].pas - 1);
    c.voie = borne(c.voie, 0, VOIES - 1);
    P.instr = borne(P.instr, 1, p.instruments.length);
    P.bruit = borne(P.bruit, 0, Math.max(0, p.bruitages.length - 1));
  }
  P.recadrer = recadrer;

  // ---------- Cellules ----------
  // champs : { n, i, v, e, p } ; seuls les champs présents sont écrits.
  P.poser = function (voie, ligne, champs, libelle) {
    var m, col, k;
    P.op(libelle || 'Saisie');
    m = P.motifE(); col = m.voies[voie];
    if (ligne < 0 || ligne >= m.pas) return;
    for (k in champs) col[k][ligne] = champs[k];
    signaler('cellule');
  };

  P.plage = function () {
    var s = P.sel, c = P.cur;
    if (!s) return { v0: c.voie, v1: c.voie, l0: c.ligne, l1: c.ligne };
    return { v0: Math.min(s.v0, s.v1), v1: Math.max(s.v0, s.v1), l0: Math.min(s.l0, s.l1), l1: Math.max(s.l0, s.l1) };
  };

  function surPlage(libelle, f) {
    var r = P.plage(), m, v, l;
    P.op(libelle);
    m = P.motifE();
    for (v = r.v0; v <= r.v1; v++) for (l = r.l0; l <= r.l1 && l < m.pas; l++) f(m.voies[v], l, v);
    signaler('cellule');
  }

  P.effacer = function () {
    surPlage('Effacer', function (c, l) { c.n[l] = c.i[l] = c.v[l] = c.e[l] = c.p[l] = 0; });
  };
  P.transposer = function (d) {
    var touche = 0;
    surPlage('Transposer', function (c, l, v) {
      var n = c.n[l];
      if (!n || n === NOTE_OFF) return;
      n += d;
      if (n < NOTE_MIN || n > NOTE_MAX) return;
      c.n[l] = n; touche++;
    });
    return touche;
  };
  P.copier = function () {
    var r = P.plage(), m = P.motif(), cols = [], v, k, o;
    for (v = r.v0; v <= r.v1; v++) {
      o = {};
      for (k in m.voies[v]) o[k] = m.voies[v][k].slice(r.l0, r.l1 + 1);
      cols.push(o);
    }
    P.presse = { lignes: r.l1 - r.l0 + 1, cols: cols };
    return P.presse.lignes * cols.length;
  };
  P.couper = function () { var n = P.copier(); P.effacer(); return n; };
  P.coller = function () {
    var pp = P.presse, c = P.cur, m, v, l, k, col;
    if (!pp) return 0;
    P.op('Coller');
    m = P.motifE();
    for (v = 0; v < pp.cols.length && c.voie + v < VOIES; v++) {
      col = m.voies[c.voie + v];
      for (l = 0; l < pp.lignes && c.ligne + l < m.pas; l++) for (k in col) col[k][c.ligne + l] = pp.cols[v][k][l];
    }
    P.sel = { v0: c.voie, l0: c.ligne, v1: Math.min(VOIES - 1, c.voie + pp.cols.length - 1), l1: Math.min(m.pas - 1, c.ligne + pp.lignes - 1) };
    signaler('cellule');
    return pp.lignes * pp.cols.length;
  };
  // Décale la voie du curseur vers le bas (sens 1) ou vers le haut (sens -1) à partir de la ligne courante.
  P.decalerLignes = function (sens) {
    var c = P.cur, m, col, k;
    P.op(sens > 0 ? 'Insérer une ligne' : 'Supprimer une ligne');
    m = P.motifE(); col = m.voies[c.voie];
    for (k in col) {
      if (sens > 0) { col[k].splice(c.ligne, 0, 0); col[k].length = m.pas; }
      else { col[k].splice(c.ligne, 1); col[k].push(0); }
    }
    signaler('cellule');
  };

  // ---------- Motifs et arrangement ----------
  P.allerOrdre = function (i) {
    var p = P.projet;
    P.cur.ordre = borne(i, 0, p.arrangement.length - 1);
    P.cur.motif = p.arrangement[P.cur.ordre].motif;
    P.sel = null; recadrer();
    signaler('curseur');
  };
  P.motifNouveau = function (dupliquer) {
    var p = P.projet, m;
    if (p.motifs.length >= 99) return;
    P.op(dupliquer ? 'Dupliquer le motif' : 'Nouveau motif');
    m = dupliquer ? copie(P.motif()) : creerMotif('', P.motif().pas);
    m.nom = dupliquer ? (m.nom + ' bis').slice(0, 12) : 'Motif ' + (p.motifs.length + 1);
    p.motifs.push(m);
    p.arrangement.splice(P.cur.ordre + 1, 0, { motif: p.motifs.length - 1, fois: 1 });
    if (p.boucle > P.cur.ordre) p.boucle++;
    P.cur.ordre++; P.cur.motif = p.motifs.length - 1; P.cur.ligne = 0; P.sel = null;
    signaler('structure');
  };
  P.motifLongueur = function (pas) {
    var m, v, k, col;
    pas = entier(pas, 1, PAS_MAX, 32);
    P.op('Longueur du motif');
    m = P.motifE();
    for (v = 0; v < VOIES; v++) {
      col = m.voies[v];
      for (k in col) { while (col[k].length < pas) col[k].push(0); col[k].length = pas; }
    }
    m.pas = pas; P.sel = null; recadrer();
    signaler('structure');
  };
  P.motifRenommer = function (nom) {
    P.op('Renommer le motif', 'nom-motif');
    P.motifE().nom = String(nom).slice(0, 12);
    signaler('structure');
  };
  P.arrAjouter = function () {
    var p = P.projet;
    if (p.arrangement.length >= 256) return;
    P.op('Ajouter à l\'arrangement');
    p.arrangement.splice(P.cur.ordre + 1, 0, { motif: P.cur.motif, fois: 1 });
    if (p.boucle > P.cur.ordre) p.boucle++;
    P.cur.ordre++;
    signaler('structure');
  };
  P.arrRetirer = function () {
    var p = P.projet;
    if (p.arrangement.length < 2) return false;
    P.op('Retirer de l\'arrangement');
    p.arrangement.splice(P.cur.ordre, 1);
    if (p.boucle > P.cur.ordre || p.boucle >= p.arrangement.length) p.boucle = Math.max(0, p.boucle - 1);
    P.cur.ordre = Math.min(P.cur.ordre, p.arrangement.length - 1);
    P.cur.motif = p.arrangement[P.cur.ordre].motif; P.sel = null; recadrer();
    signaler('structure');
    return true;
  };
  P.arrDeplacer = function (d) {
    var p = P.projet, i = P.cur.ordre, j = i + d, t;
    if (j < 0 || j >= p.arrangement.length) return;
    P.op('Déplacer dans l\'arrangement');
    t = p.arrangement[i]; p.arrangement[i] = p.arrangement[j]; p.arrangement[j] = t;
    if (p.boucle === i) p.boucle = j; else if (p.boucle === j) p.boucle = i;
    P.cur.ordre = j;
    signaler('structure');
  };
  P.arrFois = function (d) {
    var a;
    P.op('Répétitions', 'fois');
    a = P.projet.arrangement[P.cur.ordre];
    a.fois = borne(a.fois + d, 1, 16);
    signaler('structure');
  };
  P.arrMotif = function (i) {
    P.op('Changer de motif');
    P.projet.arrangement[P.cur.ordre].motif = borne(i, 0, P.projet.motifs.length - 1);
    P.cur.motif = P.projet.arrangement[P.cur.ordre].motif; P.sel = null; recadrer();
    signaler('structure');
  };
  P.arrBoucle = function () {
    P.op('Point de boucle');
    P.projet.boucle = P.cur.ordre;
    signaler('structure');
  };

  // ---------- Réglages du morceau ----------
  P.regler = function (champ, valeur) {
    P.op('Réglage', 'reglage-' + champ);
    P.projet[champ] = valeur;
    signaler('reglage');
  };

  // ---------- Instruments et bruitages ----------
  P.instrRegler = function (i, champ, valeur, bruitage) {
    var x;
    P.op(bruitage ? 'Bruitage' : 'Instrument', (bruitage ? 'b' : 'i') + i + champ);
    x = bruitage ? P.bruitE(i) : P.instrE(i);
    x[champ] = valeur;
    signaler(bruitage ? 'bruitage' : 'instrument');
  };
  P.instrNouveau = function (modele) {
    var p = P.projet, x;
    if (p.instruments.length >= 99) return;
    P.op('Nouvel instrument');
    x = modele ? copie(modele) : P.instrDefaut(0);
    if (modele) x.nom = (x.nom + ' bis').slice(0, 24);
    p.instruments.push(x);
    P.instr = p.instruments.length;
    signaler('instrument');
  };
  P.instrSupprimer = function () {
    var p = P.projet, k = P.instr, i, v, l, col, m;
    if (p.instruments.length < 2) return false;
    P.op('Supprimer l\'instrument');
    p.instruments.splice(k - 1, 1);
    for (i = 0; i < p.motifs.length; i++) {
      m = P.motifE(i);
      for (v = 0; v < VOIES; v++) {
        col = m.voies[v];
        for (l = 0; l < m.pas; l++) {
          if (col.i[l] === k) col.i[l] = 0;
          else if (col.i[l] > k) col.i[l]--;
        }
      }
    }
    recadrer();
    signaler('instrument');
    return true;
  };
  P.bruitNouveau = function (def) {
    var p = P.projet;
    if (p.bruitages.length >= 64) return;
    P.op('Nouveau bruitage');
    p.bruitages.push(normInstr(def, true));
    P.bruit = p.bruitages.length - 1;
    signaler('bruitage');
  };
  P.bruitRemplacer = function (def, libelle) {
    var p = P.projet;
    if (!p.bruitages.length) { P.bruitNouveau(def); return; }
    P.op(libelle || 'Bruitage');
    p.bruitages[P.bruit] = normInstr(def, true);
    signaler('bruitage');
  };
  P.bruitSupprimer = function () {
    var p = P.projet;
    if (!p.bruitages.length) return;
    P.op('Supprimer le bruitage');
    p.bruitages.splice(P.bruit, 1);
    recadrer();
    signaler('bruitage');
  };
})();
