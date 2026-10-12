(function () {
  'use strict';

  var P = window.Puce, C = window.Chiptune;
  var ANNEAU = 65536;                 // mémoire des oscilloscopes, en échantillons (puissance de deux)
  var VOIE_DU_TYPE = [0, 2, 3, 4];

  var ctx = null, sortie = null;
  var seq = null;                     // séquenceur de la lecture en cours
  var clavier = null;                 // puce des notes jouées au clavier
  var notesClavier = [0, 0, 0, 0, 0];
  var positions = [];                 // lignes ordonnancées : { cadre, ordre, ligne, motif }
  var position = null;
  var decalage = 0;                   // cadre audio du début du séquenceur

  P.muets = [false, false, false, false, false];
  P.solos = [false, false, false, false, false];
  P.suivre = true;
  P.etatLecture = '';                 // '', 'morceau' ou 'motif'

  // ---------- Contexte ----------
  // Créé au premier geste seulement : avant, le navigateur le refuserait.
  function contexte() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    if (!AC) return null;
    try { ctx = new AC({ sampleRate: 44100, latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    sortie = ctx.createGain();
    sortie.connect(ctx.destination);
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  P.audioEtat = function () { return ctx ? ctx.state : 'absent'; };
  P.audioFe = function () { return ctx ? ctx.sampleRate : 0; };

  // ---------- Flux ----------
  // Un flux synthétise des blocs en avance et les pose bout à bout sur l'horloge audio.
  function creerFlux(bloc, horizon, avance, periode, rendre) {
    var f = { bloc: bloc, horizon: horizon, avance: avance, periode: periode, rendre: rendre, actif: false, minuterie: 0, cadre0: 0, blocs: 0, sources: [], pv: [], anneaux: [], finEcrit: 0 }, i;
    for (i = 0; i < 5; i++) { f.pv.push(new Float32Array(bloc)); f.anneaux.push(new Float32Array(ANNEAU)); }
    return f;
  }
  function alimenter(f) {
    var fe, t, h, cadre, buf, src, encore, v, j, an, pv, base;
    if (!ctx || !f.actif) return;
    fe = ctx.sampleRate; t = ctx.currentTime;
    h = document.hidden ? Math.max(f.horizon, 1.6) : f.horizon;
    if ((f.cadre0 + f.blocs * f.bloc) / fe < t + 0.004) { f.cadre0 = Math.ceil((t + f.avance) * fe); f.blocs = 0; }
    for (;;) {
      cadre = f.cadre0 + f.blocs * f.bloc;
      if (cadre / fe >= t + h) break;
      buf = ctx.createBuffer(1, f.bloc, fe);
      encore = f.rendre(buf.getChannelData(0), f.pv, cadre, f.bloc);
      for (v = 0; v < 5; v++) {
        an = f.anneaux[v]; pv = f.pv[v]; base = cadre & (ANNEAU - 1);
        for (j = 0; j < f.bloc; j++) an[(base + j) & (ANNEAU - 1)] = pv[j];
      }
      f.finEcrit = cadre + f.bloc;
      src = ctx.createBufferSource();
      src.buffer = buf; src.connect(sortie);
      src.onended = oter.bind(null, f, src);
      src.start(cadre / fe);
      f.sources.push(src);
      f.blocs++;
      if (!encore) { clearInterval(f.minuterie); f.minuterie = 0; f.actif = false; break; }
    }
  }
  function oter(f, src) {
    var i = f.sources.indexOf(src);
    if (i >= 0) f.sources.splice(i, 1);
  }
  function demarrer(f) {
    if (f.actif) return;
    f.actif = true; f.cadre0 = 0; f.blocs = 0;
    alimenter(f);
    if (f.actif) f.minuterie = setInterval(function () { alimenter(f); }, f.periode);
  }
  function couper(f) {
    if (f.minuterie) { clearInterval(f.minuterie); f.minuterie = 0; }
    f.actif = false;
    f.sources.forEach(function (s) { try { s.stop(); } catch (e) {} });
    f.sources = []; f.finEcrit = 0;
  }

  var fluxMorceau = creerFlux(2048, 0.22, 0.05, 30, function (dest, pv, cadre, n) {
    decalage = cadre - seq.cadre;
    C.rendreSequence(seq, dest, 0, n, pv);
    return !(seq.fini && C.puceMuette(seq.puce));
  });
  var fluxClavier = creerFlux(512, 0.05, 0.012, 12, function (dest, pv, cadre, n) {
    C.rendrePuce(clavier, dest, 0, n, pv, null);
    return !C.puceMuette(clavier);
  });

  // ---------- Lecture ----------
  function muetsEffectifs() {
    var solo = P.solos.some(function (x) { return x; }), i;
    for (i = 0; i < 5; i++) seq.muets[i] = solo ? !P.solos[i] : P.muets[i];
  }
  P.voieMuette = function (v) {
    return P.solos.some(function (x) { return x; }) ? !P.solos[v] : P.muets[v];
  };
  P.majMuets = function () { if (seq) muetsEffectifs(); };

  // mode : 'morceau' (depuis la section du curseur) ou 'motif' (le motif affiché, en boucle)
  P.lire = function (mode) {
    if (!contexte()) return false;
    couper(fluxMorceau);
    positions = []; position = null;
    seq = C.creerSequenceur(P.projet, ctx.sampleRate);
    seq.boucle = true;
    if (mode === 'motif') seq.motifSeul = P.cur.motif;
    else seq.ordre = P.cur.ordre;
    seq.surLigne = function (cadre, ordre, ligne, motif) {
      positions.push({ cadre: decalage + cadre + C.RETARD, ordre: ordre, ligne: ligne, motif: motif });
      if (positions.length > 4000) positions.shift();
    };
    muetsEffectifs();
    P.etatLecture = mode;
    demarrer(fluxMorceau);
    return true;
  };
  P.arreter = function () {
    couper(fluxMorceau);
    seq = null; positions = []; position = null;
    P.etatLecture = '';
  };
  P.basculer = function (mode) {
    if (P.etatLecture) { P.arreter(); return false; }
    return P.lire(mode || 'morceau');
  };

  // Ligne que l'on entend en ce moment : { ordre, ligne, motif } ou null.
  P.positionLecture = function () {
    var c;
    if (!ctx || !seq) return null;
    c = ctx.currentTime * ctx.sampleRate;
    while (positions.length && positions[0].cadre <= c) position = positions.shift();
    return position;
  };

  // Le séquenceur lit le projet en direct : chaque modification s'entend à la ligne suivante.
  P.ecouter(function () {
    if (!seq) return;
    seq.morceau = P.projet;
    if (seq.motifSeul >= 0) seq.motifSeul = P.cur.motif;
  });

  // ---------- Clavier ----------
  // voie : celle de la grille, ou celle du type de l'instrument si elle est omise.
  P.noteClavier = function (note, instrument, voie) {
    if (!contexte()) return;
    if (!clavier || clavier.fe !== ctx.sampleRate) clavier = C.creerPuce(ctx.sampleRate);
    if (voie == null) voie = VOIE_DU_TYPE[instrument.type | 0];
    C.noteOn(clavier, voie, note, instrument, 15, false);
    notesClavier[voie] = note;
    demarrer(fluxClavier);
  };
  P.finNoteClavier = function (note) {
    var v;
    if (!clavier) return;
    for (v = 0; v < 5; v++) if (notesClavier[v] === note) { C.noteOff(clavier, v); notesClavier[v] = 0; }
  };

  // ---------- Bruitages ----------
  P.jouerBruitage = function (def) {
    var ech, buf, src;
    if (!contexte()) return null;
    ech = C.rendreBruitage(def, ctx.sampleRate);
    buf = ctx.createBuffer(1, ech.length, ctx.sampleRate);
    buf.getChannelData(0).set(ech);
    src = ctx.createBufferSource();
    src.buffer = buf; src.connect(sortie); src.start();
    return ech;
  };

  // ---------- Oscilloscopes ----------
  // Copie dans dest les derniers échantillons entendus de la voie ; renvoie leur nombre.
  P.scope = function (voie, dest) {
    var f = fluxMorceau.actif || fluxMorceau.sources.length ? fluxMorceau : fluxClavier, c, i, n = dest.length, an, debut;
    if (!ctx || !f.finEcrit) return 0;
    c = Math.floor(ctx.currentTime * ctx.sampleRate);
    debut = c - n;
    if (debut >= f.finEcrit) return 0;
    an = f.anneaux[voie];
    for (i = 0; i < n; i++) dest[i] = debut + i < f.finEcrit ? an[(debut + i) & (ANNEAU - 1)] : 0;
    return n;
  };
  P.audioActif = function () { return fluxMorceau.actif || fluxClavier.actif || fluxMorceau.sources.length > 0 || fluxClavier.sources.length > 0; };
})();
