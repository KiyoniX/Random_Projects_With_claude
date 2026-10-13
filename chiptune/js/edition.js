(function () {
  'use strict';

  var P = window.Puce;
  var NB_COLS = 7;
  // Touches du piano, par position physique : la rangée du bas puis celle du haut, une octave plus haut.
  var PIANO = {
    KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
    Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
    KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
    KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28
  };
  // Lettres d'un clavier AZERTY, pour l'aide affichée quand le navigateur ne donne pas la disposition.
  var AZERTY = {
    KeyZ: 'W', KeyS: 'S', KeyX: 'X', KeyD: 'D', KeyC: 'C', KeyV: 'V', KeyG: 'G', KeyB: 'B', KeyH: 'H', KeyN: 'N', KeyJ: 'J', KeyM: ',',
    KeyQ: 'A', Digit2: 'é', KeyW: 'Z', Digit3: '"', KeyE: 'E', KeyR: 'R', Digit5: '(', KeyT: 'T', Digit6: '-', KeyY: 'Y', Digit7: 'è', KeyU: 'U',
    KeyI: 'I', Digit9: 'ç', KeyO: 'O', Digit0: 'à', KeyP: 'P'
  };
  P.PIANO = PIANO;
  P.lettresPiano = AZERTY;
  if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
    navigator.keyboard.getLayoutMap().then(function (carte) {
      var o = {}, k;
      for (k in PIANO) o[k] = (carte.get(k) || AZERTY[k] || '').toUpperCase();
      P.lettresPiano = o;
      P.signaler('clavier');
    }).catch(function () {});
  }

  var enfoncees = {};       // code de touche -> note en cours

  function chiffre(e) {
    var m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
    return m ? parseInt(m[1], 10) : -1;
  }
  function hexa(e) {
    var d = chiffre(e), k;
    if (d >= 0) return d;
    k = e.key.toLowerCase();
    return k.length === 1 && k >= 'a' && k <= 'f' ? 10 + k.charCodeAt(0) - 97 : -1;
  }

  function bouger(dl, dc, etendre) {
    var c = P.cur, m = P.motif(), pos;
    if (etendre) { if (!P.sel) P.sel = { v0: c.voie, l0: c.ligne, v1: c.voie, l1: c.ligne }; }
    else P.sel = null;
    c.ligne = ((c.ligne + dl) % m.pas + m.pas) % m.pas;
    if (dc) {
      if (etendre) c.voie = P.borne(c.voie + dc, 0, 4);
      else {
        pos = c.voie * NB_COLS + c.col + dc;
        pos = (pos + 5 * NB_COLS) % (5 * NB_COLS);
        c.voie = Math.floor(pos / NB_COLS); c.col = pos % NB_COLS;
      }
    }
    if (etendre) { P.sel.v1 = c.voie; P.sel.l1 = c.ligne; }
    P.montrerCurseur();
    P.signaler('curseur');
  }
  P.bouger = bouger;
  function avancer() {
    var c = P.cur, m = P.motif();
    c.ligne = Math.min(m.pas - 1, c.ligne + P.pasEdition);
    P.montrerCurseur();
  }

  // Note du piano pour une touche, à l'octave courante ; 0 si la touche n'en est pas une.
  P.noteDeTouche = function (code) {
    var d = PIANO[code], n;
    if (d === undefined) return 0;
    n = (P.octave + 1) * 12 + d;
    if (P.projet.contrainte) n = P.contraindre(n);
    return n >= P.NOTE_MIN && n <= P.NOTE_MAX ? n : 0;
  };

  function saisir(e) {
    var c = P.cur, col = P.motif().voies[c.voie], l = c.ligne, d, n, k, max = P.projet.instruments.length;
    if (c.col === 0) {
      if (e.code === 'Digit1') { P.poser(c.voie, l, { n: P.NOTE_OFF, i: 0 }, 'Relâche'); avancer(); return true; }
      n = P.noteDeTouche(e.code);
      if (!n) return false;
      if (!e.repeat) {
        P.poser(c.voie, l, { n: n, i: P.instr });
        P.noteClavier(n, P.projet.instruments[P.instr - 1], c.voie);
        enfoncees[e.code] = n;
        avancer();
        P.signaler('curseur');
      }
      return true;
    }
    if (c.col === 1 || c.col === 2) {
      d = chiffre(e);
      if (d < 0) return false;
      n = c.col === 1 ? d * 10 + col.i[l] % 10 : Math.floor(col.i[l] / 10) * 10 + d;
      P.poser(c.voie, l, { i: Math.min(n, max) }, 'Instrument');
      if (c.col === 1) c.col = 2; else { c.col = 1; avancer(); }
      return true;
    }
    if (c.col === 3) {
      d = hexa(e);
      if (d < 0) return false;
      P.poser(c.voie, l, { v: d + 1 }, 'Volume');
      avancer();
      return true;
    }
    if (c.col === 4) {
      k = e.key.toUpperCase();
      if (k.length !== 1 || !P.EFFETS[k]) return false;
      P.poser(c.voie, l, { e: k.charCodeAt(0) }, 'Effet');
      c.col = 5;
      return true;
    }
    d = hexa(e);
    if (d < 0 || !col.e[l]) return false;
    n = c.col === 5 ? (d << 4) | (col.p[l] & 15) : (col.p[l] & 240) | d;
    P.poser(c.voie, l, { p: n }, 'Effet');
    if (c.col === 5) c.col = 6; else { c.col = 4; avancer(); }
    return true;
  }

  function effacerChamp() {
    var c = P.cur;
    if (P.sel) { P.effacer(); return; }
    if (c.col === 0) P.poser(c.voie, c.ligne, { n: 0, i: 0 }, 'Effacer');
    else if (c.col < 3) P.poser(c.voie, c.ligne, { i: 0 }, 'Effacer');
    else if (c.col === 3) P.poser(c.voie, c.ligne, { v: 0 }, 'Effacer');
    else P.poser(c.voie, c.ligne, { e: 0, p: 0 }, 'Effacer');
    avancer();
  }

  // Traite une touche dans la grille ; renvoie vrai si elle a servi. dire(texte) affiche un message.
  P.toucheGrille = function (e, dire) {
    var ctrl = e.ctrlKey || e.metaKey, m = P.motif(), n, k = e.key;
    if (ctrl) {
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        n = P.transposer((k === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1));
        dire(n ? n + ' note' + (n > 1 ? 's' : '') + ' transposée' + (n > 1 ? 's' : '') + (e.shiftKey ? ' d\'une octave.' : ' d\'un demi-ton.') : 'Aucune note à transposer ici.');
        return true;
      }
      if (k === 'ArrowLeft' || k === 'ArrowRight') { P.allerOrdre(P.cur.ordre + (k === 'ArrowLeft' ? -1 : 1)); return true; }
      k = k.toLowerCase();
      if (k === 'c') { n = P.copier(); dire(n + ' cellule' + (n > 1 ? 's copiées.' : ' copiée.')); return true; }
      if (k === 'x') { n = P.couper(); dire(n + ' cellule' + (n > 1 ? 's coupées.' : ' coupée.')); return true; }
      if (k === 'v') { n = P.coller(); dire(n ? 'Collé.' : 'Le presse-papiers est vide : copie d\'abord une sélection.'); return true; }
      if (k === 'a') {
        if (P.sel && P.plage().l0 === 0 && P.plage().l1 === m.pas - 1 && P.plage().v0 === P.cur.voie && P.plage().v1 === P.cur.voie) P.sel = { v0: 0, l0: 0, v1: 4, l1: m.pas - 1 };
        else P.sel = { v0: P.cur.voie, l0: 0, v1: P.cur.voie, l1: m.pas - 1 };
        P.signaler('curseur');
        return true;
      }
      return false;
    }
    if (e.altKey) return false;
    switch (k) {
      case 'ArrowUp': bouger(-1, 0, e.shiftKey); return true;
      case 'ArrowDown': bouger(1, 0, e.shiftKey); return true;
      case 'ArrowLeft': bouger(0, -1, e.shiftKey); return true;
      case 'ArrowRight': bouger(0, 1, e.shiftKey); return true;
      case 'PageUp': bouger(-Math.min(16, P.cur.ligne), 0, e.shiftKey); return true;
      case 'PageDown': bouger(Math.min(16, m.pas - 1 - P.cur.ligne), 0, e.shiftKey); return true;
      case 'Home': bouger(-P.cur.ligne, 0, e.shiftKey); return true;
      case 'End': bouger(m.pas - 1 - P.cur.ligne, 0, e.shiftKey); return true;
      case 'Tab':
        P.sel = null; P.cur.col = 0; P.cur.voie = (P.cur.voie + (e.shiftKey ? 4 : 1)) % 5;
        P.signaler('curseur');
        return true;
      case 'Escape':
        if (P.sel) { P.sel = null; P.signaler('curseur'); return true; }
        return false;
      case 'Delete':
        if (e.shiftKey) P.decalerLignes(-1); else effacerChamp();
        P.signaler('curseur');
        return true;
      case 'Backspace': effacerChamp(); P.signaler('curseur'); return true;
      case 'Insert': P.decalerLignes(1); return true;
    }
    if (e.code === 'NumpadAdd' || e.code === 'NumpadSubtract') {
      P.octave = P.borne(P.octave + (e.code === 'NumpadAdd' ? 1 : -1), 0, 7);
      P.signaler('curseur');
      return true;
    }
    if (saisir(e)) { P.signaler('curseur'); return true; }
    return false;
  };

  P.toucheRelachee = function (e) {
    var n = enfoncees[e.code];
    if (n) { delete enfoncees[e.code]; P.finNoteClavier(n); }
  };
  // Hors de la grille : le clavier joue l'instrument sans rien écrire.
  P.jouerTouche = function (e, instrument) {
    var n = P.noteDeTouche(e.code);
    if (!n) return false;
    if (!e.repeat) { P.noteClavier(n, instrument); enfoncees[e.code] = n; }
    return true;
  };

  // ---------- Souris ----------
  P.brancherGrille = function (cv) {
    var appui = false;
    function viser(e) {
      var b = cv.getBoundingClientRect();
      return P.celluleSous(cv, e.clientX - b.left, e.clientY - b.top);
    }
    cv.addEventListener('pointerdown', function (e) {
      var b = cv.getBoundingClientRect(), c = viser(e), v;
      cv.focus();
      if (!c) {
        v = P.voieSousEntete(cv, e.clientX - b.left, e.clientY - b.top);
        if (v >= 0) { P.cur.voie = v; P.sel = { v0: v, l0: 0, v1: v, l1: P.motif().pas - 1 }; P.signaler('curseur'); }
        return;
      }
      if (e.shiftKey) {
        if (!P.sel) P.sel = { v0: P.cur.voie, l0: P.cur.ligne, v1: c.voie, l1: c.ligne };
        P.sel.v1 = c.voie; P.sel.l1 = c.ligne;
      } else P.sel = null;
      P.cur.voie = c.voie; P.cur.ligne = c.ligne; P.cur.col = c.col;
      appui = true;
      cv.setPointerCapture(e.pointerId);
      P.signaler('curseur');
      e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      var c;
      if (!appui) return;
      c = viser(e);
      if (!c) return;
      if (c.voie === P.cur.voie && c.ligne === P.cur.ligne && !P.sel) return;
      if (!P.sel) P.sel = { v0: P.cur.voie, l0: P.cur.ligne, v1: c.voie, l1: c.ligne };
      if (P.sel.v1 !== c.voie || P.sel.l1 !== c.ligne) { P.sel.v1 = c.voie; P.sel.l1 = c.ligne; P.signaler('curseur'); }
    });
    cv.addEventListener('pointerup', function () { appui = false; });
    cv.addEventListener('pointercancel', function () { appui = false; });
    cv.addEventListener('wheel', function (e) {
      P.vue.haut = Math.max(0, P.vue.haut + (e.deltaY > 0 ? 4 : -4));
      P.signaler('vue');
      e.preventDefault();
    }, { passive: false });
  };
})();
