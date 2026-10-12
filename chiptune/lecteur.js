/*
 * lecteur.js : la puce sonore de « La Puce à l'oreille » et son lecteur autonome.
 * Un seul fichier, sans dépendance. Il synthétise lui-même chaque échantillon
 * (deux carrés, un triangle, un bruit, une table d'onde) : aucun fichier audio à embarquer.
 *
 * Dans un jeu :
 *
 *   <script src="../chiptune/lecteur.js"></script>
 *   <script src="musique.js"></script>     (export « Fichier pour le lecteur » de l'outil)
 *
 *   Chiptune.jouer('premier-niveau');             // en boucle, à partir du point de boucle
 *   Chiptune.bruitage('saut');                    // par-dessus la musique
 *   Chiptune.arreter(0.5);                        // fondu d'une demi-seconde
 *
 * Le fichier musique.js exporté par l'outil contient un appel
 *   Chiptune.ajouter('premier-niveau', { ...morceau et bruitages... });
 * On peut aussi passer directement l'objet JSON d'un projet : Chiptune.jouer(objet).
 *
 * Le navigateur n'autorise le son qu'après un geste du joueur. Le lecteur s'en charge :
 * un appel à jouer() fait trop tôt démarre de lui-même au premier clic ou à la première touche.
 *
 * Autres appels :
 *   Chiptune.jouer(nom, { boucle: false, volume: 0.8 })
 *   Chiptune.bruitage(nom, { volume: 0.6, hauteur: +3 })   hauteur en demi-tons
 *   Chiptune.volume(v)  Chiptune.volumeBruitages(v)  Chiptune.muet(vrai)  Chiptune.enCours()
 *
 * Sans navigateur (Node, tests, export) :
 *   Chiptune.rendreMorceau(morceau, { fe: 44100, boucle: true })  -> Float32Array
 *   Chiptune.rendreBruitage(bruitage, 44100)                      -> Float32Array
 */
(function (racine) {
  'use strict';

  var TAPS = 32;            // largeur du noyau de reconstruction, en échantillons
  var PHASES = 512;         // positions du noyau entre deux échantillons
  var RETARD = 15;          // retard introduit par le noyau
  var BLOC = 2048;
  var VOIES = 5;
  var TICS = 60;            // cadence des enveloppes, arpèges et vibratos, par seconde
  var CARRE = 0, TRIANGLE = 1, BRUIT = 2, ONDE = 3;
  var TYPES = [CARRE, CARRE, TRIANGLE, BRUIT, ONDE];
  var GAINS = [0.145, 0.145, 0.17, 0.105, 0.145];
  var MULT_BRUIT = 32;      // cadence du registre à décalage, en multiples de la fréquence de la note
  var NOTE_OFF = 255;
  var LOIN = 0x3fffffff;
  var QUEUE_MAX = 3;        // secondes de relâchement gardées après la dernière ligne
  var FORMAT = 'puce-chiptune';

  var C = {
    FORMAT: FORMAT, VOIES: VOIES, TICS: TICS, RETARD: RETARD, NOTE_OFF: NOTE_OFF,
    TYPES: TYPES, GAINS: GAINS, CARRE: CARRE, TRIANGLE: TRIANGLE, BRUIT: BRUIT, ONDE: ONDE,
    morceaux: {}, bruitages: {}
  };

  // ---------- Noyau à bande limitée ----------
  // Chaque voix est un signal en escalier. Plutôt que de l'échantillonner (ce qui replie les aigus),
  // on dépose à chaque marche un sinus cardinal fenêtré, placé au 512e d'échantillon, puis on intègre.
  function bessel0(x) {
    var s = 1, t = 1, k;
    for (k = 1; k < 40; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; }
    return s;
  }

  var noyau = (function () {
    var n = new Float64Array(PHASES * TAPS), beta = 8, i0 = bessel0(beta), demi = TAPS / 2, p, j, x, w, v, s;
    for (p = 0; p < PHASES; p++) {
      s = 0;
      for (j = 0; j < TAPS; j++) {
        x = j - RETARD - p / PHASES;
        w = 1 - (x / demi) * (x / demi);
        v = w <= 0 ? 1 / i0 : bessel0(beta * Math.sqrt(w)) / i0;
        if (x !== 0) v *= Math.sin(Math.PI * x) / (Math.PI * x);
        n[p * TAPS + j] = v;
        s += v;
      }
      // Chaque phase somme exactement à 1 : une marche déposée vaut sa hauteur, sans dérive.
      for (j = 0; j < TAPS; j++) n[p * TAPS + j] /= s;
    }
    return n;
  })();

  function impulsion(buf, temps, delta) {
    var i = temps | 0, k = (((temps - i) * PHASES) | 0) * TAPS, j;
    for (j = 0; j < TAPS; j++) buf[i + j] += noyau[k + j] * delta;
  }

  // ---------- Formes d'onde ----------
  var FORMES_CARRE = (function () {
    var hauts = [1, 2, 4, 6], t = [], r, i, f;
    for (r = 0; r < 4; r++) {
      f = new Float32Array(8);
      for (i = 0; i < 8; i++) f[i] = i < hauts[r] ? 1 : -1;
      t.push(f);
    }
    return t;
  })();

  // Triangle à 32 marches de 4 bits, comme sur la NES ; il démarre à mi-hauteur.
  var FORME_TRI = (function () {
    var f = new Float32Array(32), i, k, v;
    for (i = 0; i < 32; i++) { k = (i + 8) & 31; v = k < 16 ? k : 31 - k; f[i] = (v - 7.5) / 7.5; }
    return f;
  })();

  var ONDE_DEFAUT = [8, 10, 12, 14, 15, 15, 14, 12, 10, 8, 6, 4, 2, 1, 0, 0, 1, 2, 4, 5, 7, 9, 11, 13, 13, 11, 9, 7, 5, 3, 2, 4];
  var INSTR_DEFAUT = { nom: 'Défaut', type: 0, vol: 15, env: 'adsr', a: 0, d: 8, s: 10, r: 3, rap: 2 };

  // ---------- Puce ----------
  function creerVoix(i) {
    var type = TYPES[i];
    return {
      type: type, gain: GAINS[i],
      forme: type === CARRE ? FORMES_CARRE[2] : type === ONDE ? new Float32Array(32) : FORME_TRI,
      masque: type === CARRE ? 7 : 31,
      ins: null, fini: true,
      note: 60, cible: 60, glisse: 0, k: 0, relache: -1, env: 0, envRel: 0, volNote: 15,
      vol: 0, per: 100, t: 0, pas: 0, lfsr: 1, court: false, niveau: 0, resteTic: LOIN,
      arp: new Int8Array(3), arpN: 0, vibProf: 0, vibVit: 6, effGliss: 0, effRap: -1, coupe: -1, porta: 0,
      acc: 0, buf: new Float64Array(BLOC + TAPS + 2)
    };
  }

  C.creerPuce = function (fe) {
    var pu = { fe: fe, tic: Math.round(fe / TICS), voix: [], volume: 1 }, i;
    for (i = 0; i < VOIES; i++) pu.voix.push(creerVoix(i));
    return pu;
  };

  // Aligne le niveau de sortie sur l'état courant (volume, rapport cyclique), à l'instant pos.
  function ajuster(v, pos) {
    var x = 0;
    if (v.vol > 0) {
      x = v.vol * v.gain / 15;
      if (v.type === BRUIT) { if (!(v.lfsr & 1)) x = -x; }
      else x *= v.forme[v.pas];
    }
    if (x !== v.niveau) { impulsion(v.buf, pos, x - v.niveau); v.niveau = x; }
  }

  function tic(pu, v, pos) {
    var ins = v.ins, k = v.k, e, n, i, p, seq, f, per, x;
    if (!ins) { v.fini = true; v.vol = 0; ajuster(v, pos); return; }

    if (v.coupe >= 0 && k >= v.coupe && v.relache < 0) { v.relache = k; v.envRel = v.env; }

    if (v.relache >= 0) {
      n = ins.r | 0; i = k - v.relache;
      if (i >= n) { e = 0; v.fini = true; } else e = v.envRel * (1 - i / n);
    } else {
      seq = ins.pas;
      if (ins.env === 'pas' && seq && seq.length) {
        n = seq.length; i = k;
        if (i >= n) {
          p = ins.pasBoucle;
          if (p >= 0 && p < n) i = p + (i - n) % (n - p);
          else { i = n - 1; if (!seq[i]) v.fini = true; }
        }
        e = seq[i];
      } else {
        n = ins.a | 0; i = ins.d | 0; x = ins.s == null ? 15 : ins.s;
        if (k < n) e = 15 * (k + 1) / (n + 1);
        else if (k < n + i) e = 15 - (15 - x) * (k - n) / i;
        else { e = x; if (!x) v.fini = true; }
      }
      v.env = e;
    }
    v.vol = Math.round(e * (ins.vol == null ? 15 : ins.vol) * v.volNote / 225);

    if (v.note !== v.cible) {
      if (v.porta <= 0) v.note = v.cible;
      else if (v.note < v.cible) v.note = Math.min(v.cible, v.note + v.porta);
      else v.note = Math.max(v.cible, v.note - v.porta);
    }
    if (k > 0) v.glisse += ((ins.gliss || 0) + v.effGliss) / 100;
    p = v.note + v.glisse;
    n = ins.chuteDuree | 0;
    if (ins.chute && k < n) p += ins.chute * (1 - k / n);
    if (v.arpN) p += v.arp[k % v.arpN];
    else if ((seq = ins.arp) && seq.length) {
      i = (k / (ins.arpVit || 1)) | 0;
      p += seq[ins.arpBoucle === false ? Math.min(i, seq.length - 1) : i % seq.length];
    }
    if (v.vibProf) p += v.vibProf / 100 * Math.sin(2 * Math.PI * v.vibVit * k / TICS);
    else if (ins.vibProf) {
      i = k - (ins.vibDelai | 0);
      if (i > 0) p += ins.vibProf / 100 * Math.sin(2 * Math.PI * (ins.vibVit || 6) * i / TICS);
    }
    f = 440 * Math.pow(2, (p - 69) / 12);
    if (v.type === BRUIT) {
      per = pu.fe / (f * MULT_BRUIT);
      if (per < pu.fe / 250000) per = pu.fe / 250000;
      v.court = !!ins.court;
    } else {
      if (f > 12000) f = 12000;
      if (f < 8) f = 8;
      per = pu.fe / (f * (v.masque + 1));
      if (v.type === CARRE) {
        seq = ins.rapSeq;
        if (v.effRap >= 0) i = v.effRap;
        else if (seq && seq.length) {
          i = (k / (ins.rapVit || 1)) | 0;
          i = seq[ins.rapBoucle === false ? Math.min(i, seq.length - 1) : i % seq.length];
        } else i = ins.rap == null ? 2 : ins.rap;
        v.forme = FORMES_CARRE[i & 3];
      }
    }
    v.per = per;
    v.k = k + 1;
    if (v.fini) v.vol = 0;
    ajuster(v, pos);
  }

  function avancer(v, base, n) {
    if (v.vol === 0) return;
    var t = v.t, per = v.per, amp = v.vol * v.gain / 15, niv = v.niveau, buf = v.buf, x, l, dec, f, m, p;
    if (v.type === BRUIT) {
      l = v.lfsr; dec = v.court ? 6 : 1;
      while (t < n) {
        l = (l >> 1) | (((l ^ (l >> dec)) & 1) << 14);
        x = (l & 1) ? amp : -amp;
        if (x !== niv) { impulsion(buf, base + t, x - niv); niv = x; }
        t += per;
      }
      v.lfsr = l;
    } else {
      f = v.forme; m = v.masque; p = v.pas;
      while (t < n) {
        p = (p + 1) & m;
        x = f[p] * amp;
        if (x !== niv) { impulsion(buf, base + t, x - niv); niv = x; }
        t += per;
      }
      v.pas = p;
    }
    v.t = t - n;
    v.niveau = niv;
  }

  // Remplit sortie[debut .. debut + n). parVoix (facultatif) reçoit le signal de chaque voix.
  C.rendrePuce = function (pu, sortie, debut, n, parVoix, muets) {
    var voix = pu.voix, c, pos, seg, i, j, v, buf, acc, g, pv;
    while (n > 0) {
      c = n < BLOC ? n : BLOC;
      pos = 0;
      while (pos < c) {
        seg = c - pos;
        for (i = 0; i < VOIES; i++) {
          v = voix[i];
          if (v.resteTic === 0) { tic(pu, v, pos); v.resteTic = v.fini ? LOIN : pu.tic; }
          if (v.resteTic < seg) seg = v.resteTic;
        }
        for (i = 0; i < VOIES; i++) {
          v = voix[i];
          avancer(v, pos, seg);
          if (v.resteTic !== LOIN) v.resteTic -= seg;
        }
        pos += seg;
      }
      for (j = 0; j < c; j++) sortie[debut + j] = 0;
      for (i = 0; i < VOIES; i++) {
        v = voix[i]; buf = v.buf; acc = v.acc;
        g = (muets && muets[i]) ? 0 : pu.volume;
        pv = parVoix ? parVoix[i] : null;
        if (pv) {
          for (j = 0; j < c; j++) { acc += buf[j]; pv[debut + j] = acc; sortie[debut + j] += acc * g; }
        } else {
          for (j = 0; j < c; j++) { acc += buf[j]; sortie[debut + j] += acc * g; }
        }
        v.acc = acc;
        buf.copyWithin(0, c, c + TAPS);
        buf.fill(0, TAPS, c + TAPS);
      }
      debut += c;
      n -= c;
    }
  };

  C.noteOn = function (pu, voie, note, ins, vol, lie) {
    var v = pu.voix[voie], o, i;
    ins = ins || INSTR_DEFAUT;
    if (ins.noteFixe) note = ins.noteFixe;
    v.cible = note;
    if (lie && v.ins && !v.fini && v.relache < 0) return;
    v.ins = ins; v.note = note; v.k = 0; v.relache = -1; v.fini = false; v.glisse = 0; v.env = 0;
    v.volNote = vol == null ? 15 : vol;
    v.t = 0; v.pas = v.masque; v.lfsr = 1; v.resteTic = 0;
    v.arpN = 0; v.vibProf = 0; v.effGliss = 0; v.effRap = -1; v.coupe = -1; v.porta = 0;
    if (v.type === ONDE) {
      o = ins.onde && ins.onde.length === 32 ? ins.onde : ONDE_DEFAUT;
      for (i = 0; i < 32; i++) v.forme[i] = (o[i] - 7.5) / 7.5;
    }
  };

  C.noteOff = function (pu, voie) {
    var v = pu.voix[voie];
    if (v.ins && !v.fini && v.relache < 0) { v.relache = v.k; v.envRel = v.env; v.resteTic = 0; }
  };

  // Effets de la colonne d'effet ; ils durent jusqu'à la note suivante.
  C.effet = function (pu, voie, lettre, p) {
    var v = pu.voix[voie], x = p >> 4, y = p & 15;
    if (lettre === 65) { v.arp[0] = 0; v.arp[1] = x; v.arp[2] = y; v.arpN = y ? 3 : x ? 2 : 0; }
    else if (lettre === 77) v.effGliss = p;
    else if (lettre === 68) v.effGliss = -p;
    else if (lettre === 80) v.porta = (p || 8) / 16;
    else if (lettre === 86) { v.vibVit = x || 6; v.vibProf = y * 10; }
    else if (lettre === 82) v.effRap = p & 3;
    else if (lettre === 67) v.coupe = v.k + p;
  };

  C.puceMuette = function (pu) {
    for (var i = 0; i < VOIES; i++) if (!pu.voix[i].fini) return false;
    return true;
  };

  // ---------- Séquenceur ----------
  // Un morceau : { tempo, pasParTemps, swing, instruments[], motifs[], arrangement[], boucle }.
  // Un motif : { nom, pas, voies[5] }, chaque voie rangeant ses colonnes dans cinq tableaux
  // n (note MIDI, 0 = vide, 255 = relâche), i (instrument, 0 = le précédent), v (volume + 1, 0 = plein),
  // e (lettre de l'effet, 0 = aucun) et p (son paramètre).
  function dureeLigne(mo, fe) {
    return fe * 60 / ((mo.tempo || 120) * (mo.pasParTemps || 4));
  }
  function decalage(k, pas, L, swing) {
    if (k >= pas) return Math.round(pas * L);
    return Math.round((k + ((k & 1) ? swing : 0)) * L);
  }

  C.creerSequenceur = function (morceau, fe) {
    return {
      morceau: morceau, fe: fe, puce: C.creerPuce(fe),
      ordre: 0, rep: 0, ligne: 0, reste: 0, cadre: 0,
      boucle: true, motifSeul: -1, aFinir: false, fini: false, tours: 0,
      insCour: [1, 1, 1, 1, 1], muets: [false, false, false, false, false],
      surLigne: null
    };
  };

  function jouerLigne(s) {
    var mo = s.morceau, arr = mo.arrangement || [], pu = s.puce, im, m, l, vo, col, note, num, vol, e, L, sw, i;
    if (s.aFinir) { s.fini = true; for (i = 0; i < VOIES; i++) C.noteOff(pu, i); return; }
    if (s.motifSeul >= 0) im = s.motifSeul;
    else {
      if (!arr.length) { s.fini = true; return; }
      if (s.ordre >= arr.length) { s.ordre = 0; s.rep = 0; }
      im = arr[s.ordre].motif;
    }
    m = mo.motifs[im];
    if (!m) { s.fini = true; return; }
    if (s.ligne >= m.pas) s.ligne = 0;
    l = s.ligne;
    if (mo.volume != null) pu.volume = mo.volume;

    for (vo = 0; vo < VOIES; vo++) {
      col = m.voies[vo];
      note = col.n[l]; num = col.i[l]; vol = col.v[l]; e = col.e[l];
      if (num) s.insCour[vo] = num;
      if (note === NOTE_OFF) C.noteOff(pu, vo);
      else if (note) C.noteOn(pu, vo, note, mo.instruments[s.insCour[vo] - 1], vol ? vol - 1 : 15, e === 80);
      else if (vol) pu.voix[vo].volNote = vol - 1;
      if (e) C.effet(pu, vo, e, col.p[l]);
    }
    if (s.surLigne) s.surLigne(s.cadre, s.motifSeul >= 0 ? -1 : s.ordre, l, im);

    L = dureeLigne(mo, s.fe); sw = mo.swing || 0;
    s.reste = Math.max(1, decalage(l + 1, m.pas, L, sw) - decalage(l, m.pas, L, sw));

    s.ligne++;
    if (s.ligne >= m.pas) {
      s.ligne = 0;
      if (s.motifSeul >= 0) { if (!s.boucle) s.aFinir = true; else s.tours++; }
      else {
        s.rep++;
        if (s.rep >= (arr[s.ordre].fois || 1)) {
          s.rep = 0; s.ordre++;
          if (s.ordre >= arr.length) {
            if (s.boucle) { s.ordre = Math.min(mo.boucle | 0, arr.length - 1); s.tours++; }
            else s.aFinir = true;
          }
        }
      }
    }
  }

  C.rendreSequence = function (s, sortie, debut, n, parVoix) {
    var seg;
    while (n > 0) {
      if (s.reste === 0 && !s.fini) jouerLigne(s);
      seg = s.fini ? n : Math.min(n, s.reste);
      C.rendrePuce(s.puce, sortie, debut, seg, parVoix, s.muets);
      if (!s.fini) s.reste -= seg;
      debut += seg; n -= seg; s.cadre += seg;
    }
  };

  C.dureeMotif = function (mo, im, fe) {
    var m = mo.motifs[im];
    return m ? Math.round(m.pas * dureeLigne(mo, fe)) : 0;
  };

  // Durée du morceau en échantillons, et position du point de boucle.
  C.dureeMorceau = function (mo, fe) {
    var arr = mo.arrangement || [], total = 0, debut = 0, b = Math.min(mo.boucle | 0, Math.max(0, arr.length - 1)), i;
    for (i = 0; i < arr.length; i++) {
      if (i === b) debut = total;
      total += C.dureeMotif(mo, arr[i].motif, fe) * (arr[i].fois || 1);
    }
    return { cadres: total, debutBoucle: debut };
  };

  // Rendu hors temps réel. opt : fe, boucle (boucle parfaite : la fin se raccorde au début),
  // motif (indice d'un motif à rendre seul), muets.
  C.rendreMorceau = function (mo, opt) {
    opt = opt || {};
    var fe = opt.fe || 44100, s = C.creerSequenceur(mo, fe), seul = opt.motif != null && opt.motif >= 0;
    var d = seul ? { cadres: C.dureeMotif(mo, opt.motif, fe), debutBoucle: 0 } : C.dureeMorceau(mo, fe);
    var tout, n, max, fait;
    if (seul) s.motifSeul = opt.motif;
    if (opt.muets) s.muets = opt.muets;
    if (!d.cadres) return new Float32Array(0);
    if (opt.boucle) {
      // Deuxième passage de la boucle : les queues de la fin retombent sur le début.
      s.boucle = true;
      n = d.cadres - d.debutBoucle;
      tout = new Float32Array(d.debutBoucle + 2 * n + RETARD);
      C.rendreSequence(s, tout, 0, tout.length);
      return tout.slice(d.debutBoucle + n + RETARD);
    }
    s.boucle = false;
    max = d.cadres + RETARD + QUEUE_MAX * fe;
    tout = new Float32Array(max);
    fait = d.cadres + RETARD + 1;
    C.rendreSequence(s, tout, 0, fait);
    while (fait < max && !(s.fini && C.puceMuette(s.puce))) {
      n = Math.min(1024, max - fait);
      C.rendreSequence(s, tout, fait, n);
      fait += n;
    }
    n = Math.min(TAPS * 2, max - fait);
    C.rendreSequence(s, tout, fait, n);
    return tout.slice(RETARD, fait + n);
  };

  // ---------- Bruitages ----------
  // Un bruitage est un instrument auquel on ajoute une note et une durée de tenue (en tics de 1/60 s).
  var VOIE_DU_TYPE = [0, 2, 3, 4];

  C.rendreBruitage = function (b, fe, hauteur) {
    fe = fe || 44100;
    var pu = C.creerPuce(fe), voie = VOIE_DU_TYPE[b.type | 0] || 0, max = Math.round(fe * 4);
    var tout = new Float32Array(max), tenue = Math.max(1, b.duree | 0) * pu.tic, fait = 0, n;
    C.noteOn(pu, voie, (b.note || 60) + (hauteur || 0), b, 15, false);
    if (b.noteFixe) pu.voix[voie].note = pu.voix[voie].cible = b.noteFixe + (hauteur || 0);
    pu.voix[voie].gain = 0.4;
    n = Math.min(tenue, max);
    C.rendrePuce(pu, tout, 0, n); fait = n;
    C.noteOff(pu, voie);
    while (fait < max - 1024 && !C.puceMuette(pu)) { C.rendrePuce(pu, tout, fait, 512); fait += 512; }
    n = Math.min(TAPS * 2, max - fait);
    C.rendrePuce(pu, tout, fait, n);
    return tout.slice(RETARD, fait + n);
  };

  // ---------- Lecture dans le navigateur ----------
  // Les blocs sont synthétisés en avance et posés bout à bout sur l'horloge audio :
  // la lecture reste calée même quand les minuteries de la page prennent du retard.
  var audio = {
    ctx: null, sortie: null, gMusique: null, gBruits: null, seq: null, minuterie: 0,
    cadre0: 0, blocs: 0, sources: [], cache: {}, attente: null, geste: false,
    vMusique: 1, vBruits: 1, muet: false
  };
  var doc = racine.document;

  function contexte() {
    if (audio.ctx) return audio.ctx;
    var AC = racine.AudioContext || racine.webkitAudioContext, ctx;
    if (!AC) return null;
    try { ctx = new AC({ sampleRate: 44100, latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    audio.ctx = ctx;
    audio.sortie = ctx.createGain();
    audio.sortie.gain.value = audio.muet ? 0 : 1;
    audio.sortie.connect(ctx.destination);
    audio.gMusique = ctx.createGain(); audio.gMusique.connect(audio.sortie);
    audio.gBruits = ctx.createGain(); audio.gBruits.gain.value = audio.vBruits; audio.gBruits.connect(audio.sortie);
    return ctx;
  }

  function surGeste() {
    audio.geste = true;
    if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
    if (audio.attente) { var a = audio.attente; audio.attente = null; C.jouer(a[0], a[1]); }
  }
  if (doc && doc.addEventListener) {
    ['pointerdown', 'keydown', 'touchend'].forEach(function (t) { doc.addEventListener(t, surGeste, true); });
  }
  function actif() {
    return audio.geste || !!(racine.navigator && racine.navigator.userActivation && racine.navigator.userActivation.hasBeenActive);
  }

  function couper() {
    if (audio.minuterie) { clearInterval(audio.minuterie); audio.minuterie = 0; }
    audio.sources.forEach(function (s) { try { s.stop(); } catch (e) {} });
    audio.sources = [];
    audio.seq = null;
  }

  function alimenter() {
    var ctx = audio.ctx, s = audio.seq, fe, t, horizon, cadre, buf, src;
    if (!ctx || !s) return;
    fe = ctx.sampleRate; t = ctx.currentTime;
    horizon = doc && doc.hidden ? 1.6 : 0.3;
    if ((audio.cadre0 + audio.blocs * BLOC) / fe < t + 0.02) { audio.cadre0 = Math.ceil((t + 0.06) * fe); audio.blocs = 0; }
    for (;;) {
      cadre = audio.cadre0 + audio.blocs * BLOC;
      if (cadre / fe >= t + horizon) break;
      buf = ctx.createBuffer(1, BLOC, fe);
      C.rendreSequence(s, buf.getChannelData(0), 0, BLOC);
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(audio.gMusique);
      src.onended = finSource;
      src.start(cadre / fe);
      audio.sources.push(src);
      audio.blocs++;
      if (s.fini && C.puceMuette(s.puce)) { clearInterval(audio.minuterie); audio.minuterie = 0; audio.seq = null; break; }
    }
  }
  function finSource() {
    var i = audio.sources.indexOf(this);
    if (i >= 0) audio.sources.splice(i, 1);
  }

  C.ajouter = function (nom, donnees) {
    C.morceaux[nom] = donnees;
    (donnees.bruitages || []).forEach(function (b) { C.bruitages[cle(b.nom)] = b; });
  };
  function cle(nom) {
    return String(nom).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  C.cle = cle;

  C.jouer = function (morceau, opt) {
    opt = opt || {};
    var mo = typeof morceau === 'string' ? C.morceaux[morceau] : morceau, ctx, g;
    if (!mo || !mo.motifs || !(racine.AudioContext || racine.webkitAudioContext)) return false;
    if (!actif()) { audio.attente = [morceau, opt]; return true; }
    ctx = contexte();
    if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume();
    couper();
    g = audio.gMusique.gain;
    if (opt.volume != null) audio.vMusique = opt.volume;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(audio.vMusique, ctx.currentTime);
    audio.seq = C.creerSequenceur(mo, ctx.sampleRate);
    audio.seq.boucle = opt.boucle !== false;
    audio.blocs = 0; audio.cadre0 = 0;
    alimenter();
    audio.minuterie = setInterval(alimenter, 40);
    return true;
  };

  C.arreter = function (fondu) {
    var ctx = audio.ctx, g, ancien;
    audio.attente = null;
    if (!ctx || !audio.seq) { couper(); return; }
    if (!fondu) { couper(); return; }
    g = audio.gMusique.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(0, ctx.currentTime + fondu);
    ancien = audio.seq;
    setTimeout(function () { if (audio.seq === ancien) couper(); }, fondu * 1000 + 60);
  };

  C.enCours = function () { return !!audio.seq || !!audio.attente; };

  C.bruitage = function (nom, opt) {
    opt = opt || {};
    var b = typeof nom === 'string' ? C.bruitages[cle(nom)] : nom, ctx, k, buf, ech, src, g;
    if (!b || !actif() || !(racine.AudioContext || racine.webkitAudioContext)) return false;
    ctx = contexte();
    if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume();
    k = typeof nom === 'string' ? cle(nom) : null;
    buf = k && audio.cache[k] && audio.cache[k].def === b ? audio.cache[k].buf : null;
    if (!buf) {
      ech = C.rendreBruitage(b, ctx.sampleRate);
      buf = ctx.createBuffer(1, ech.length, ctx.sampleRate);
      buf.getChannelData(0).set(ech);
      if (k) audio.cache[k] = { def: b, buf: buf };
    }
    src = ctx.createBufferSource();
    src.buffer = buf;
    if (opt.hauteur) src.playbackRate.value = Math.pow(2, opt.hauteur / 12);
    g = ctx.createGain();
    g.gain.value = opt.volume == null ? 1 : opt.volume;
    src.connect(g); g.connect(audio.gBruits);
    src.start();
    return true;
  };

  C.volume = function (v) {
    audio.vMusique = v;
    if (audio.ctx) audio.gMusique.gain.setValueAtTime(v, audio.ctx.currentTime);
  };
  C.volumeBruitages = function (v) {
    audio.vBruits = v;
    if (audio.ctx) audio.gBruits.gain.setValueAtTime(v, audio.ctx.currentTime);
  };
  C.muet = function (oui) {
    audio.muet = !!oui;
    if (audio.ctx) audio.sortie.gain.setValueAtTime(oui ? 0 : 1, audio.ctx.currentTime);
  };
  C.contexte = function () { return actif() ? contexte() : null; };

  racine.Chiptune = C;
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
})(typeof window !== 'undefined' ? window : globalThis);
