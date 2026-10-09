// Moteur de langues inventées : sons, mots, grammaire, écriture, traduction et évolution.
// Utilisé par la Fabrique de langues et par l'Atlas des mondes.
(function () {
  'use strict';

  var Lang = window.Lang = {};

  Lang.rng = function (str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = h << 13 | h >>> 19;
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    var a = (h ^ (h >>> 16)) >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  };

  // ---------- Sons ----------
  var CONS = Lang.CONS = { m: 10, n: 10, k: 9, t: 9, p: 8, s: 8, l: 8, r: 7, h: 6, b: 6, d: 6, g: 6, w: 5, y: 5, f: 5, sh: 4, ch: 4, v: 4, z: 3, dj: 3, kh: 3, th: 2, q: 2, "'": 2 };
  var VOWS = Lang.VOWS = { a: 10, i: 9, u: 8, e: 7, o: 7, 'é': 4, ou: 4, eu: 2, ai: 3, au: 2 };
  var isV = function (p) { return VOWS.hasOwnProperty(p); };
  var has = function (arr, x) { return arr.indexOf(x) >= 0; };
  var TOKENS = Object.keys(CONS).concat(Object.keys(VOWS)).sort(function (a, b) { return b.length - a.length; });

  // Découpe un mot écrit en sons (« sh », « ou » comptent pour un seul son)
  Lang.segment = function (str) {
    var s = str.toLowerCase(), out = [], i = 0;
    while (i < s.length) {
      var found = null;
      for (var k = 0; k < TOKENS.length; k++) if (s.substr(i, TOKENS[k].length) === TOKENS[k]) { found = TOKENS[k]; break; }
      if (found) { out.push(found); i += found.length; } else i++;
    }
    return out;
  };

  function weighted(r, pool, weights) {
    var total = 0, i;
    for (i = 0; i < pool.length; i++) total += weights[pool[i]];
    var x = r() * total;
    for (i = 0; i < pool.length; i++) { x -= weights[pool[i]]; if (x <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }
  function sample(r, weights, n, must) {
    var pool = Object.keys(weights), out = [];
    (must || []).forEach(function (m) { out.push(m); pool.splice(pool.indexOf(m), 1); });
    while (out.length < n && pool.length) {
      var p = weighted(r, pool, weights);
      out.push(p); pool.splice(pool.indexOf(p), 1);
    }
    return out;
  }

  // ---------- Lois phonétiques (évolution) ----------
  var between = function (w, i) { return i > 0 && i < w.length - 1 && isV(w[i - 1]) && isV(w[i + 1]); };
  var mapAt = function (table, cond) {
    return function (w) { return w.map(function (p, i) { return table[p] && cond(w, i) ? table[p] : p; }); };
  };
  var always = function () { return true; };
  Lang.RULES = [
    { id: 'len', label: 'p, t, k s\'adoucissent en f, s, kh entre deux voyelles', f: mapAt({ p: 'f', t: 's', k: 'kh' }, between) },
    { id: 'voi', label: 'p, t, k deviennent b, d, g entre deux voyelles', f: mapAt({ p: 'b', t: 'd', k: 'g' }, between) },
    { id: 'apo', label: 'la voyelle finale des mots longs tombe', f: function (w) { return w.length >= 5 && isV(w[w.length - 1]) && !isV(w[w.length - 2]) ? w.slice(0, -1) : w; } },
    { id: 'pal', label: 'k et t deviennent ch devant i et é', f: mapAt({ k: 'ch', t: 'ch' }, function (w, i) { return w[i + 1] === 'i' || w[i + 1] === 'é'; }) },
    { id: 'sh', label: 's devient h en début de mot', f: mapAt({ s: 'h' }, function (w, i) { return i === 0; }) },
    { id: 'hdel', label: 'h disparaît', f: function (w) { var o = w.filter(function (p) { return p !== 'h'; }); return o.length ? o : w; } },
    { id: 'ao', label: 'a devient o', f: mapAt({ a: 'o' }, always) },
    { id: 'ei', label: 'e devient i', f: mapAt({ e: 'i' }, always) },
    { id: 'oou', label: 'o devient ou', f: mapAt({ o: 'ou' }, always) },
    { id: 'mono', label: 'ai devient é, au devient o', f: mapAt({ ai: 'é', au: 'o' }, always) },
    { id: 'dev', label: 'b, d, g, z, v deviennent p, t, k, s, f en fin de mot', f: mapAt({ b: 'p', d: 't', g: 'k', z: 's', v: 'f' }, function (w, i) { return i === w.length - 1; }) },
    { id: 'rl', label: 'r se confond avec l', f: mapAt({ r: 'l' }, always) },
    { id: 'nas', label: 'n et m tombent en fin de mot', f: function (w) { var last = w[w.length - 1]; return w.length > 2 && (last === 'n' || last === 'm') ? w.slice(0, -1) : w; } },
    { id: 'wv', label: 'w devient v, y devient dj', f: mapAt({ w: 'v', y: 'dj' }, always) },
    { id: 'clu', label: 'les groupes de consonnes se simplifient', f: function (w) { return w.filter(function (p, i) { return !(i > 0 && !isV(p) && !isV(w[i - 1]) && i < w.length - 1); }); } },
    { id: 'bk', label: 'kh devient h, th devient t, q devient k', f: mapAt({ kh: 'h', th: 't', q: 'k' }, always) }
  ];

  // ---------- Vocabulaire de base (concepts en français) ----------
  var NOUNS = ('soleil lune étoile ciel:cieux terre eau:eaux mer rivière pluie neige glace vent feu:feux pierre montagne forêt arbre herbe fleur sable nuage nuit jour lumière ombre monde chemin île lac désert saison hiver été année matin soir champ ' +
    'homme femme enfant ami ennemi peuple roi reine chef mère père frère sœur fils:fils fille dieu:dieux étranger chasseur guerrier ' +
    'tête œil:yeux main pied cœur bouche sang os:os peau:peaux voix:voix ' +
    'animal:animaux bête poisson oiseau:oiseaux chien chat troupeau:troupeaux ' +
    'maison village ville nom mot langue chant histoire nourriture viande pain fruit couteau:couteaux bateau:bateaux porte route arme cadeau:cadeaux rêve mort vie guerre paix:paix amour peur temps:temps chose vérité force bois:bois sel fer').split(' ');
  var NOUN_CATS = [['Nature', 40], ['Êtres', 59], ['Corps', 69], ['Animaux', 76], ['Choses et idées', 999]];
  var ADJS = ('grand petit bon:bonne mauvais beau:belle:beaux:belles vieux:vieille:vieux:vieilles jeune nouveau:nouvelle:nouveaux:nouvelles rouge bleu vert noir blanc:blanche jaune chaud froid long:longue court fort faible rapide lent sage ' +
    'fou:folle heureux:heureuse:heureux:heureuses triste vivant sacré premier:première dernier:dernière seul haut profond lourd léger:légère plein vide sombre clair libre lointain proche dangereux:dangereuse:dangereux:dangereuses doux:douce:doux:douces dur ancien:ancienne').split(' ');
  var VERBS_IRR = {
    'être': 'suis es est sommes êtes sont|été|ser|ét',
    'avoir': 'ai as a avons avez ont|eu|aur|av',
    'aller': 'vais vas va allons allez vont|allé|ir|all',
    'faire': 'fais fait faisons faites font|fait|fer|fais',
    'voir': 'vois voit voyons voyez voient|vu|verr|voy',
    'venir': 'viens vient venons venez viennent|venu|viendr|ven',
    'pouvoir': 'peux peut pouvons pouvez peuvent|pu|pourr|pouv',
    'vouloir': 'veux veut voulons voulez veulent|voulu|voudr|voul',
    'savoir': 'sais sait savons savez savent|su|saur|sav',
    'dire': 'dis dit disons dites disent|dit|dir|dis',
    'prendre': 'prends prend prenons prenez prennent|pris|prendr|pren',
    'boire': 'bois boit buvons buvez boivent|bu|boir|buv',
    'dormir': 'dors dort dormons dormez dorment|dormi|dormir|dorm',
    'mourir': 'meurs meurt mourons mourez meurent|mort|mourr|mour',
    'vivre': 'vis vit vivons vivez vivent|vécu|vivr|viv',
    'connaître': 'connais connaît connaissons connaissez connaissent|connu|connaîtr|connaiss',
    'partir': 'pars part partons partez partent|parti|partir|part',
    'courir': 'cours court courons courez courent|couru|courr|cour',
    'entendre': 'entends entend entendons entendez entendent|entendu|entendr|entend',
    'écrire': 'écris écrit écrivons écrivez écrivent|écrit|écrir|écriv',
    'lire': 'lis lit lisons lisez lisent|lu|lir|lis',
    'tenir': 'tiens tient tenons tenez tiennent|tenu|tiendr|ten',
    'ouvrir': 'ouvre ouvres ouvrons ouvrez ouvrent|ouvert|ouvrir|ouvr',
    'construire': 'construis construit construisons construisez construisent|construit|construir|construis',
    'naître': 'nais naît naissons naissez naissent|né|naîtr|naiss'
  };
  var VERBS_ER = 'aimer manger parler chanter donner chasser marcher regarder trouver chercher tomber porter tuer brûler briller voler nager danser penser appeler habiter travailler jouer pleurer rêver garder couper écouter monter rester arriver entrer apporter cacher lever briser pêcher cultiver traverser raconter demander oublier compter créer prier'.split(' ');
  var VERBS_IR = 'finir grandir choisir nourrir bâtir'.split(' ');
  var MOTION = ['aller', 'venir', 'partir', 'tomber', 'mourir', 'arriver', 'entrer', 'rester', 'monter', 'naître'];
  var PREPS = { dans: 'dans', sur: 'sur', sous: 'sous', avec: 'avec', sans: 'sans', pour: 'pour', vers: 'vers', chez: 'chez', entre: 'entre', devant: 'devant', 'derrière': 'derrière', 'après': 'après', avant: 'avant', contre: 'contre', depuis: 'depuis', pendant: 'pendant', comme: 'comme', par: 'par', 'à': 'à', en: 'dans' };
  var ADVS = ['très', 'bien', 'mal', 'toujours', 'jamais', 'ici', 'là', 'maintenant', 'aujourdhui', 'demain', 'hier', 'beaucoup', 'peu', 'encore', 'aussi', 'déjà', 'vite', 'loin', 'ensemble', 'peutêtre', 'rien'];
  var INTS = ['oui', 'non', 'bonjour', 'merci', 'adieu', 'salut'];
  var WHS = { qui: 'qui', que: 'quoi', quoi: 'quoi', 'où': 'où', comment: 'comment', pourquoi: 'pourquoi', combien: 'combien' };
  var CONJS = { et: 'et', ou: 'ou', mais: 'mais', car: 'car', parceque: 'car', quand: 'quand', si: 'si' };
  var NUMW = { 'zéro': 0, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, vingt: 20, cent: 100, mille: 1000 };
  var PRON = { je: '1SG', "j'": '1SG', tu: '2SG', il: '3SG', elle: '3SG', on: '3SG', nous: '1PL', vous: '2PL', ils: '3PL', elles: '3PL', moi: '1SG', toi: '2SG', lui: '3SG', eux: '3PL' };
  var OBJP = { me: '1SG', "m'": '1SG', te: '2SG', "t'": '2SG', nous: '1PL', vous: '2PL', lui: '3SG', leur: '3PL' };
  var POSS = { mon: '1SG', ma: '1SG', mes: '1SG+', ton: '2SG', ta: '2SG', tes: '2SG+', son: '3SG', sa: '3SG', ses: '3SG+', notre: '1PL', nos: '1PL+', votre: '2PL', vos: '2PL+', leur: '3PL', leurs: '3PL+' };
  var FEMS = { amie: 'ami', ennemie: 'ennemi', 'étrangère': 'étranger', chasseuse: 'chasseur', 'guerrière': 'guerrier', chienne: 'chien', chatte: 'chat' };

  // Tables de formes françaises -> concept
  var FR_N = {}, FR_A = {}, FR_V = {}, CONCEPTS = [];
  NOUNS.forEach(function (entry, idx) {
    var p = entry.split(':'), sg = p[0], pl = p[1] || sg + 's', cat = '';
    for (var c = 0; c < NOUN_CATS.length; c++) if (idx <= NOUN_CATS[c][1]) { cat = NOUN_CATS[c][0]; break; }
    FR_N[sg] = { c: sg, pl: false, both: pl === sg };
    if (pl !== sg) FR_N[pl] = { c: sg, pl: true };
    CONCEPTS.push({ fr: sg, pos: 'nom', cat: cat });
  });
  Object.keys(FEMS).forEach(function (f) { FR_N[f] = { c: FEMS[f], pl: false }; FR_N[f + 's'] = { c: FEMS[f], pl: true }; });
  ADJS.forEach(function (entry) {
    var p = entry.split(':'), m = p[0];
    var forms = p.length > 1 ? p : (/e$/.test(m) ? [m] : [m, m + 'e']);
    forms.forEach(function (f) { FR_A[f] = m; if (!/[sx]$/.test(f)) FR_A[f + 's'] = m; });
    CONCEPTS.push({ fr: m, pos: 'adj.', cat: 'Qualités' });
  });
  var addV = function (form, lemma, t) { if (!FR_V[form]) FR_V[form] = []; FR_V[form].push({ c: lemma, t: t }); };
  var IMPF = ['ais', 'ait', 'ions', 'iez', 'aient'], FUT = ['ai', 'as', 'a', 'ons', 'ez', 'ont'];
  Object.keys(VERBS_IRR).forEach(function (lemma) {
    var p = VERBS_IRR[lemma].split('|');
    addV(lemma, lemma, 'inf');
    p[0].split(' ').forEach(function (f) { addV(f, lemma, 'pres'); });
    [p[1], p[1] + 'e', p[1] + 's', p[1] + 'es'].forEach(function (f) { addV(f, lemma, 'part'); });
    FUT.forEach(function (e) { addV(p[2] + e, lemma, 'fut'); });
    IMPF.forEach(function (e) { addV(p[3] + e, lemma, 'past'); });
    CONCEPTS.push({ fr: lemma, pos: 'verbe', cat: 'Verbes' });
  });
  VERBS_ER.forEach(function (lemma) {
    var st = lemma.slice(0, -2), soft = /g$/.test(st) ? st + 'e' : st;
    var pres = lemma === 'appeler' ? 'appell' : lemma === 'lever' ? 'lèv' : st;
    addV(lemma, lemma, 'inf');
    [pres + 'e', pres + 'es', soft + 'ons', st + 'ez', pres + 'ent'].forEach(function (f) { addV(f, lemma, 'pres'); });
    ['é', 'ée', 'és', 'ées'].forEach(function (e) { addV(st + e, lemma, 'part'); });
    FUT.forEach(function (e) { addV((pres === st ? st : pres) + 'er' + e, lemma, 'fut'); });
    IMPF.forEach(function (e) { addV((/^[ai]/.test(e) && e !== 'ions' && e !== 'iez' ? soft : st) + e, lemma, 'past'); });
    CONCEPTS.push({ fr: lemma, pos: 'verbe', cat: 'Verbes' });
  });
  VERBS_IR.forEach(function (lemma) {
    var st = lemma.slice(0, -2);
    addV(lemma, lemma, 'inf');
    ['is', 'it', 'issons', 'issez', 'issent'].forEach(function (e) { addV(st + e, lemma, 'pres'); });
    ['i', 'ie', 'is', 'ies'].forEach(function (e) { addV(st + e, lemma, 'part'); });
    FUT.forEach(function (e) { addV(lemma + e, lemma, 'fut'); });
    IMPF.forEach(function (e) { addV(st + 'iss' + e, lemma, 'past'); });
    CONCEPTS.push({ fr: lemma, pos: 'verbe', cat: 'Verbes' });
  });
  addV('ilya', 'exister', 'pres'); addV('ilyavait', 'exister', 'past'); addV('ilyaura', 'exister', 'fut');
  CONCEPTS.push({ fr: 'exister', pos: 'verbe', cat: 'Verbes', label: 'il y a' });
  Object.keys(PREPS).forEach(function (p) { if (p !== 'en') CONCEPTS.push({ fr: p, pos: 'prép.', cat: 'Petits mots' }); });
  ADVS.forEach(function (a) { CONCEPTS.push({ fr: a, pos: 'adv.', cat: 'Petits mots', label: a === 'aujourdhui' ? 'aujourd\'hui' : a === 'peutêtre' ? 'peut-être' : a }); });
  INTS.forEach(function (a) { if (a !== 'salut') CONCEPTS.push({ fr: a, pos: 'excl.', cat: 'Petits mots' }); });
  ['qui', 'quoi', 'où', 'comment', 'pourquoi', 'combien', 'et', 'ou', 'mais', 'car', 'quand', 'si', 'que'].forEach(function (a) { CONCEPTS.push({ fr: a, pos: 'mot', cat: 'Petits mots' }); });
  var PRON_FR = { '1SG': 'je, moi', '2SG': 'tu, toi', '3SG': 'il, elle', '1PL': 'nous', '2PL': 'vous', '3PL': 'ils, elles', DEM: 'ce, cela' };
  Object.keys(PRON_FR).forEach(function (k) { CONCEPTS.push({ fr: k, pos: 'pron.', cat: 'Petits mots', label: PRON_FR[k] }); });
  var SHORT = { 'être': 1, avoir: 1, aller: 1, eau: 1, feu: 1, et: 1, ou: 1, si: 1 };

  // ---------- Création d'une langue ----------
  Lang.create = function (seed, opts) {
    opts = opts || {};
    var env = opts.env || null, r = Lang.rng('sons' + seed);
    var L = { seed: seed, env: env, opts: opts, traits: [], rules: [], laws: [], _base: {}, _used: {}, _form: {}, missing: {}, years: 0 };

    // Inventaire
    var nC = 9 + Math.floor(r() * 6), nV = 3 + Math.floor(r() * 4);
    var cons = sample(r, CONS, nC, [weighted(r, ['m', 'n'], CONS), weighted(r, ['t', 'k'], CONS), weighted(r, ['l', 'r'], CONS)]);
    var vows = sample(r, VOWS, nV, ['a']);
    var pOnset = 0.8 + r() * 0.2, pCluster = r() < 0.4 ? r() * 0.25 : 0, pCoda = r() * 0.45, long = 0;
    var drop = function (list) { cons = cons.filter(function (c) { return !has(list, c); }); };
    var need = function (arr, list) { list.forEach(function (x) { if (!has(arr, x)) arr.push(x); }); };
    if (env) {
      if (env.aquatic) {
        drop(['p', 'b', 'm', 'f', 'v', 'w']); need(cons, ['q', "'", 'kh', 'n', 't', 'k']);
        L.traits.push({ cause: 'Peuple marin', effect: 'aucune consonne faite avec les lèvres ; des claquements de gorge (q, kh, \') qui portent sous l\'eau' });
      }
      if (env.P <= 0.45) {
        drop(['h', 'f', 'th']); need(cons, ['k', 't']);
        L.traits.push({ cause: 'Air ténu', effect: 'les souffles légers ne portent pas : ni h ni f, des consonnes frappées' });
      } else if (env.P >= 2.2) {
        need(vows, ['o', 'ou']); long = 0.5;
        L.traits.push({ cause: 'Air dense', effect: 'voix graves qui portent loin : beaucoup de o et de ou, des mots longs' });
      }
      if (!env.aquatic && env.T < 0) {
        vows = vows.slice(0, 3); pCoda = 0.55; pCluster = Math.max(pCluster, 0.22);
        L.traits.push({ cause: 'Froid, ' + Math.round(env.T) + ' °C', effect: 'on ouvre peu la bouche : trois voyelles, des syllabes fermées et des groupes de consonnes' });
      } else if (!env.aquatic && env.T > 24 && env.M > 0.45) {
        need(vows, ['i', 'o', 'e', 'u']); pCoda = 0.04; pCluster = 0;
        L.traits.push({ cause: 'Chaleur humide', effect: 'syllabes ouvertes consonne + voyelle, beaucoup de voyelles' });
      }
    }
    if (opts.cons && opts.cons.length >= 3) cons = opts.cons.slice();
    if (opts.vows && opts.vows.length >= 1) vows = opts.vows.slice();
    L.cons = cons; L.vows = vows;
    var cw = {}, vw = {};
    cons.forEach(function (c) { cw[c] = CONS[c]; }); vows.forEach(function (v) { vw[v] = VOWS[v]; });
    var codas = cons.filter(function (c) { return has(['n', 'm', 'l', 'r', 's', 'k', 't', 'th', 'sh', 'kh'], c); });
    var liquids = cons.filter(function (c) { return has(['l', 'r', 'w'], c); });
    if (!codas.length) pCoda = 0;
    L.shape = (pCluster > 0.05 && liquids.length ? '(C)(L)V' : '(C)V') + (pCoda > 0.08 ? '(C)' : '');

    function syllable(rr, forceOnset) {
      var s = [];
      if (forceOnset || rr() < pOnset) {
        var c = weighted(rr, cons, cw);
        s.push(c);
        if (liquids.length && rr() < pCluster && has(['p', 't', 'k', 'b', 'd', 'g', 'f', 's'], c)) { var l = liquids[Math.floor(rr() * liquids.length)]; if (l !== c) s.push(l); }
      }
      s.push(weighted(rr, vows, vw));
      if (rr() < pCoda) s.push(codas[Math.floor(rr() * codas.length)]);
      return s;
    }
    function makeWord(rr, n) {
      var w = [];
      for (var i = 0; i < n; i++) w = w.concat(syllable(rr, w.length && isV(w[w.length - 1])));
      return w;
    }
    L.syllable = function (rr) { return syllable(rr, true).join(''); };

    // Générateur de noms propres (planètes, espèces, cités)
    L.word = function (rr, min, max) {
      var w = makeWord(rr, min + Math.floor(rr() * (max - min + 1))).join('');
      return w.charAt(0).toUpperCase() + w.slice(1);
    };

    // Racine stable d'un concept
    L.base = function (key) {
      if (L._base[key]) return L._base[key];
      var rr = Lang.rng(seed + '#' + key), short = SHORT[key] || /^[A-Z0-9+]+$/.test(key) || PREPS[key];
      var w, tries = 0;
      do {
        var n = short ? 1 : 1 + Math.floor(rr() * 2 + 0.35 + long) + (tries > 3 ? 1 : 0);
        w = makeWord(rr, n);
        if (short && w.length < 2) w = makeWord(rr, 1);
        tries++;
      } while (L._used[w.join('')] && tries < 12);
      L._used[w.join('')] = true;
      return (L._base[key] = w);
    };
    L.form = function (key) {
      var self = this;
      if (self._form[key]) return self._form[key];
      var w = L.base(key);
      self.rules.forEach(function (rule) { w = rule.f(w); });
      return (self._form[key] = w.join(''));
    };

    // Grammaire
    var g = Lang.rng('gram' + seed), pick = function (list) { return list[Math.floor(g() * list.length)]; };
    var o = g();
    var G = L.G = {
      order: opts.order || (o < 0.42 ? 'SOV' : o < 0.8 ? 'SVO' : o < 0.92 ? 'VSO' : o < 0.96 ? 'VOS' : o < 0.98 ? 'OVS' : 'OSV'),
      adjAfter: g() < 0.6,
      plural: pick(['suffixe', 'suffixe', 'préfixe', 'redoublement', 'particule', 'aucun']),
      caseAcc: g() < 0.4,
      def: pick(['aucun', 'aucun', 'suffixe', 'mot avant', 'mot après']),
      tense: pick(['suffixe', 'suffixe', 'préfixe', 'particule avant', 'particule après']),
      agree: g() < 0.35,
      neg: pick(['particule avant', 'particule avant', 'particule après', 'suffixe']),
      qEnd: g() < 0.7,
      possAfter: g() < 0.5,
      copula: g() < 0.6,
      genAfter: g() < 0.6,
      base: pick([10, 10, 12, 8, 20, 6])
    };
    G.postp = /V$/.test(G.order) ? g() < 0.85 : g() < 0.12;
    G.vFinal = /V$/.test(G.order);

    L.num = function (n) {
      var self = this, b = G.base;
      function nm(x) {
        if (x === 0) return self.form('N0');
        if (x < b) return self.form('N' + x);
        if (x < b * b) { var q = Math.floor(x / b), rest = x % b; return (q > 1 ? nm(q) + '-' : '') + self.form('NB') + (rest ? '-' + nm(rest) : ''); }
        var q2 = Math.floor(x / (b * b)), r2 = x % (b * b);
        return (q2 > 1 ? nm(Math.min(q2, b * b - 1)) + '-' : '') + self.form('NBB') + (r2 ? '-' + nm(r2) : '');
      }
      return nm(Math.max(0, Math.min(n, b * b * b - 1)));
    };

    // Variante vieillie ou dialecte : mêmes racines, lois phonétiques en plus
    L.derive = function (key, count, years) {
      var parent = this, child = Object.create(parent), rr = Lang.rng(seed + '~' + key);
      var pool = Lang.RULES.filter(function (x) { return !parent.rules.some(function (y) { return y.id === x.id; }); });
      var test = CONCEPTS.slice(0, 120).map(function (c) { return L.base(c.fr); });
      var cur = test.map(function (w) { parent.rules.forEach(function (rule) { w = rule.f(w); }); return w; });
      var added = [];
      while (added.length < count && pool.length) {
        var rule = pool.splice(Math.floor(rr() * pool.length), 1)[0], changed = 0;
        var next = cur.map(function (w) { var n = rule.f(w); if (n.join('') !== w.join('')) changed++; return n; });
        if (changed >= 8) { added.push(rule); cur = next; }
      }
      child.rules = parent.rules.concat(added);
      child.laws = added.map(function (x) { return x.label; });
      child._form = {};
      child.years = years || 0;
      return child;
    };

    L.dictionary = function () {
      var self = this;
      return CONCEPTS.map(function (c) {
        return { fr: c.label || c.fr, pos: c.pos, cat: c.cat, word: self.missing[c.fr] ? null : self.form(c.fr), why: self.missing[c.fr] || '' };
      });
    };

    L.translate = function (text) { return translate(this, text); };
    L.glyph = function (p) { return glyph(L, p); };
    L.write = function (str, size) { return write(L, str, size); };
    L.script = scriptStyle(L, opts.medium);
    return L;
  };

  // ---------- Écriture ----------
  var MEDIA = {
    grave: { name: 'gravée', desc: 'traits droits, taillés dans l\'os, la glace ou le bois' },
    peinte: { name: 'peinte', desc: 'courbes souples tracées au pinceau' },
    perles: { name: 'en perles', desc: 'points et anneaux, à l\'image des colliers de coquillages enfilés' }
  };
  function scriptStyle(L, medium) {
    var r = Lang.rng('script' + L.seed);
    var kind = medium || (r() < 0.5 ? 'grave' : r() < 0.8 ? 'peinte' : 'perles');
    return { kind: kind, name: MEDIA[kind].name, desc: MEDIA[kind].desc, bar: kind !== 'perles' && r() < 0.45, _g: {}, _sig: {} };
  }
  function glyph(L, p) {
    var S = L.script;
    if (S._g[p]) return S._g[p];
    var r = Lang.rng('glyphe' + L.seed + p), xs = [3, 10, 17], ys = [5, 12, 19, 26], d = '', sig, tries = 0;
    do {
      d = ''; sig = '';
      var pt = function () { return [Math.floor(r() * 3), Math.floor(r() * 4)]; };
      if (S.kind === 'perles') {
        var n = 2 + Math.floor(r() * 3), seen = {};
        for (var i = 0; i < n; i++) {
          var a = pt(), key = a.join('');
          if (seen[key]) continue;
          seen[key] = 1; sig += key;
          var ring = r() < 0.35;
          d += '<circle cx="' + xs[a[0]] + '" cy="' + ys[a[1]] + '" r="' + (ring ? 3.2 : 2.3) + '" fill="' + (ring ? 'none' : 'currentColor') + '" stroke="currentColor" stroke-width="1.6"/>';
        }
        if (r() < 0.5) { var b = pt(), c = pt(); d += '<line x1="' + xs[b[0]] + '" y1="' + ys[b[1]] + '" x2="' + xs[c[0]] + '" y2="' + ys[c[1]] + '" stroke="currentColor" stroke-width="1.2"/>'; sig += 'l' + b.join('') + c.join(''); }
      } else {
        var cur = pt(), steps = 2 + Math.floor(r() * 3), path = 'M' + xs[cur[0]] + ' ' + ys[cur[1]];
        sig = cur.join('');
        for (var s = 0; s < steps; s++) {
          var nx = pt();
          if (nx[0] === cur[0] && nx[1] === cur[1]) nx = [(cur[0] + 1) % 3, (cur[1] + 2) % 4];
          if (S.kind === 'peinte') {
            var mx = (xs[cur[0]] + xs[nx[0]]) / 2 + (r() - 0.5) * 16, my = (ys[cur[1]] + ys[nx[1]]) / 2 + (r() - 0.5) * 16;
            path += ' Q' + mx.toFixed(1) + ' ' + my.toFixed(1) + ' ' + xs[nx[0]] + ' ' + ys[nx[1]];
          } else path += ' L' + xs[nx[0]] + ' ' + ys[nx[1]];
          sig += nx.join(''); cur = nx;
        }
        d = '<path d="' + path + '" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
        if (isV(p)) { var dot = pt(); d += '<circle cx="' + (xs[dot[0]] + 3) + '" cy="' + (ys[dot[1]] - 3) + '" r="1.7" fill="currentColor"/>'; sig += 'd' + dot.join(''); }
      }
      tries++;
    } while (S._sig[sig] && tries < 8);
    S._sig[sig] = true;
    return (S._g[p] = d);
  }
  function write(L, str, size) {
    var h = size || 30, scale = h / 31, x = 0, out = '', words = String(str).split(/[\s-]+/).filter(Boolean);
    words.forEach(function (w) {
      var ph = Lang.segment(w);
      if (!ph.length) return;
      if (L.script.bar) out += '<line x1="' + (x + 1) + '" y1="1.5" x2="' + (x + ph.length * 21 - 2) + '" y2="1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';
      ph.forEach(function (p) { out += '<g transform="translate(' + x + ' 0)">' + glyph(L, p) + '</g>'; x += 21; });
      x += 12;
    });
    var wTotal = Math.max(1, x - 12);
    return '<svg class="script" viewBox="0 0 ' + wTotal + ' 31" width="' + (wTotal * scale).toFixed(0) + '" height="' + h + '" role="img" aria-label="Texte dans l\'écriture de la langue">' + out + '</svg>';
  }

  // ---------- Traduction du français ----------
  var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };

  function classify(L, tokens) {
    var items = [];
    for (var i = 0; i < tokens.length; i++) {
      var raw = tokens[i], t = raw.toLowerCase(), prev = items[items.length - 1], next = (tokens[i + 1] || '').toLowerCase();
      var pk = prev ? prev.k : '', nounCtx = pk === 'ART' || pk === 'POSS' || pk === 'DEM' || pk === 'NUM' || pk === 'ADJ' || pk === 'PREP';
      var start = 0;
      for (var b = items.length - 1; b >= 0; b--) if (items[b].k === 'CONJ') { start = b + 1; break; }
      var here = items.slice(start);
      var hasSubj = here.some(function (x) { return x.k === 'PRON' || x.k === 'N' || x.k === 'NAME'; });
      var hasVerb = here.some(function (x) { return x.k === 'V'; });
      var v = FR_V[t];
      if (/^\d+$/.test(t)) { items.push({ k: 'NUM', n: +t, src: raw }); continue; }
      if (t === 'ne' || t === "n'" || t === 'se' || t === "s'" || t === 'y') continue;
      if (t === 'pas' || t === 'plus' && pk === 'V') { items.push({ k: 'NEG', src: raw }); continue; }
      if (t === 'estceque') { items.push({ k: 'Q' }); continue; }
      if (t === "c'" || t === 'cela' || t === 'ça' || t === 'ceci') { items.push({ k: 'PRON', p: 'DEM', src: raw }); continue; }
      if (t === "qu'") t = 'que';
      if (t === "d'") t = 'de';
      // Pronoms objets placés avant le verbe : « je te vois », « il la mange »
      if (hasSubj && !hasVerb && FR_V[next] && !nounCtx && (OBJP[t] || t === 'le' || t === 'la' || t === 'les' || t === "l'")) {
        items.push({ k: 'OBJ', p: OBJP[t] || (t === 'les' ? '3PL' : '3SG'), src: raw }); continue;
      }
      if (PRON[t] && !(t === 'lui' && nounCtx)) { items.push({ k: 'PRON', p: PRON[t], src: raw }); continue; }
      if (t === 'le' || t === 'la' || t === "l'" || t === 'les') { items.push({ k: 'ART', def: true, pl: t === 'les', src: raw }); continue; }
      if (t === 'un' || t === 'une') { items.push({ k: 'ART', def: false, pl: false, src: raw }); continue; }
      if (t === 'des' || t === 'du' || t === 'de') {
        // « de » après un nom : complément du nom ; après un verbe : article partitif
        if (pk === 'N' || pk === 'NAME' || pk === 'ADJ' && items.length > 1) items.push({ k: 'GEN', def: t !== 'de', pl: t === 'des', src: raw });
        else if (t === 'de' && pk === 'V' && FR_V[next] && FR_V[next][0].t === 'inf') continue;
        else if (t === 'de' && pk !== 'V' && pk !== 'NEG' && pk !== 'ADV') items.push({ k: 'PREP', c: 'depuis', src: raw });
        else items.push({ k: 'ART', def: false, pl: t === 'des', src: raw });
        continue;
      }
      if (t === 'au' || t === 'aux') { items.push({ k: 'PREP', c: 'à', src: raw }); items.push({ k: 'ART', def: true, pl: t === 'aux' }); continue; }
      if (POSS[t] && !(t === 'leur' && FR_V[next] && hasSubj)) { items.push({ k: 'POSS', p: POSS[t].replace('+', ''), pl: /\+$/.test(POSS[t]) || /s$/.test(t), src: raw }); continue; }
      if (t === 'ce' || t === 'cet' || t === 'cette' || t === 'ces') { items.push({ k: 'DEM', pl: t === 'ces', src: raw }); continue; }
      if (NUMW.hasOwnProperty(t)) { items.push({ k: 'NUM', n: NUMW[t], src: raw }); continue; }
      if ((t === 'que' || t === 'qui') && i > 0 && i < tokens.length - 1 && pk !== 'CONJ' && pk !== 'PREP') { items.push({ k: 'CONJ', c: 'que', src: raw }); continue; }
      if (CONJS[t] && !(t === 'si' && FR_A[next])) { items.push({ k: 'CONJ', c: CONJS[t], src: raw }); continue; }
      if (WHS[t] && (i === 0 || pk === 'CONJ' || pk === 'PREP' || i === tokens.length - 1)) { items.push({ k: 'WH', c: WHS[t], src: raw }); continue; }
      if (INTS.indexOf(t) >= 0) { items.push({ k: 'INT', c: t === 'salut' ? 'bonjour' : t, src: raw }); continue; }
      // Noms propres : majuscule ailleurs qu'en début de phrase, ou mot inconnu à majuscule
      if (raw.charAt(0) !== t.charAt(0) && (i > 0 || !(FR_N[t] || FR_A[t] || v || PREPS[t] || ADVS.indexOf(t) >= 0))) { items.push({ k: 'NAME', text: raw, src: raw }); continue; }
      var n = FR_N[t], a = FR_A[t];
      if (n && v) { if (nounCtx || !hasSubj && i > 0) v = null; else n = null; }
      if (a && v && (nounCtx || pk === 'N')) v = null;
      if (n && a) { if (pk === 'N' || pk === 'V' || pk === 'ADV') n = null; else a = null; }
      if (v) { items.push({ k: 'V', c: v[0].c, t: v[0].t, alt: v, src: raw }); continue; }
      if (n) { items.push({ k: 'N', c: n.c, pl: n.pl, both: n.both, src: raw }); continue; }
      if (a) { items.push({ k: 'ADJ', c: a, src: raw }); continue; }
      if (PREPS[t]) { items.push({ k: 'PREP', c: PREPS[t], src: raw }); continue; }
      if (ADVS.indexOf(t) >= 0) { items.push({ k: 'ADV', c: t, src: raw }); continue; }
      // Mot inconnu : on devine son rôle d'après sa place, et on lui invente une racine
      var guess = nounCtx ? 'N' : pk === 'N' && !items.some(function (x) { return x.k === 'V'; }) && /(e|es|ent|ons|ez|it|ait)$/.test(t) ? 'V'
        : pk === 'PRON' || pk === 'OBJ' || pk === 'NEG' ? 'V' : pk === 'N' ? 'ADJ' : pk === 'V' && /(er|ir|re)$/.test(t) ? 'V' : 'N';
      if (guess === 'V') items.push({ k: 'V', c: 'x:' + t.replace(/(ent|ons|ez|es|e|ait|ais|é|ée|er)$/, ''), t: /(é|ée|és)$/.test(t) ? 'part' : /(er|ir|re)$/.test(t) ? 'inf' : /(ait|ais)$/.test(t) ? 'past' : 'pres', src: raw, coined: true });
      else if (guess === 'ADJ') items.push({ k: 'ADJ', c: 'x:' + t.replace(/(es|e|s)$/, ''), src: raw, coined: true });
      else items.push({ k: 'N', c: 'x:' + t.replace(/s$/, ''), pl: /s$/.test(t) && pk === 'ART' && prev.pl, src: raw, coined: true });
    }
    return items;
  }

  function chunk(items) {
    var chunks = [], cur = null, pendingPrep = null, pendingGen = null, intens = null;
    var close = function () {
      if (!cur) return;
      if (pendingGen && pendingGen.owner) { pendingGen.owner.gen = cur; pendingGen = null; }
      else if (pendingPrep) { chunks.push({ k: 'PP', prep: pendingPrep, np: cur }); pendingPrep = null; }
      else chunks.push(cur);
      cur = null;
    };
    var open = function () { if (!cur) cur = { k: 'NP', adjs: [], det: {}, pl: false, src: [] }; return cur; };
    var lastNP = function () {
      var c = cur || chunks[chunks.length - 1];
      if (!c) return null;
      if (c.k === 'PP') c = c.np;
      while (c && c.gen) c = c.gen;
      return c && c.k === 'NP' ? c : null;
    };
    items.forEach(function (it) {
      switch (it.k) {
        case 'ART': case 'POSS': case 'DEM': case 'NUM':
          if (cur && (cur.head || cur.adjs.length)) close();
          open();
          if (it.k === 'ART') { cur.det.def = it.def; if (it.pl) cur.pl = true; }
          else if (it.k === 'POSS') { cur.det.poss = it.p; cur.det.def = true; if (it.pl) cur.pl = true; }
          else if (it.k === 'DEM') { cur.det.dem = true; if (it.pl) cur.pl = true; }
          else { cur.det.num = it.n; if (it.n > 1) cur.pl = true; }
          break;
        case 'ADJ':
          open().adjs.push({ c: it.c, int: intens, coined: it.coined, before: !cur.head }); intens = null; break;
        case 'N': case 'NAME':
          if (cur && cur.head) close();
          open().head = it; if (it.pl) cur.pl = true; if (it.both && cur.det.def === undefined && !cur.pl) cur.pl = false;
          break;
        case 'PRON': close(); chunks.push({ k: 'NP', pron: it.p, adjs: [], det: {}, pl: /PL/.test(it.p) }); break;
        case 'OBJ': close(); chunks.push({ k: 'NP', pron: it.p, adjs: [], det: {}, pl: /PL/.test(it.p), obj: true }); break;
        case 'GEN': { var owner = lastNP(); close(); if (owner) { pendingGen = { owner: owner }; open().det.def = it.def; if (it.pl) cur.pl = true; } break; }
        case 'PREP': close(); pendingPrep = it.c; break;
        case 'V': {
          close();
          var j = chunks.length - 1;
          while (j >= 0 && chunks[j].k === 'ADV') j--;
          var last = chunks[j];
          if (last && last.k === 'VG' && !last.closed) last.verbs.push(it); else chunks.push({ k: 'VG', verbs: [it], neg: false });
          break;
        }
        case 'NEG': { close(); for (var i = chunks.length - 1; i >= 0; i--) if (chunks[i].k === 'VG') { chunks[i].neg = true; break; } break; }
        case 'ADV': if (it.c === 'très' || it.c === 'peu' && cur) intens = it.c; else { close(); chunks.push({ k: 'ADV', c: it.c }); } break;
        default: close(); chunks.push(it);
      }
      if (it.k !== 'V' && it.k !== 'NEG' && it.k !== 'ADV') chunks.forEach(function (c) { if (c.k === 'VG') c.closed = true; });
    });
    close();
    return chunks;
  }

  function translate(L, text) {
    var G = L.G, notes = [], out = [];
    var prepared = String(text).replace(/[’`]/g, "'").replace(/aujourd'hui/gi, 'aujourdhui').replace(/est-ce qu[e']\s*/gi, 'estceque ')
      .replace(/parce qu[e']\s*/gi, 'parceque ').replace(/peut-être/gi, 'peutêtre').replace(/\bil y avait\b/gi, 'ilyavait').replace(/\bil y aura\b/gi, 'ilyaura').replace(/\bil y a\b/gi, 'ilya');
    var sentences = prepared.split(/([.!?;:]+)/);
    var W = function (word, gloss, flags) { return { w: word, g: gloss, coined: flags && flags.coined, name: flags && flags.name }; };
    var root = function (c, coined) {
      if (L.missing[c]) { notes.push('« ' + c + ' » : ' + L.missing[c] + ' ; traduit par une périphrase.'); return L.form('§' + c); }
      if (coined) notes.push('« ' + c.slice(2) + ' » n\'est pas dans le dictionnaire : une racine a été inventée.');
      return L.form(c);
    };

    function np(n, role) {
      var words = [], head, gloss;
      if (n.pron) { head = L.form(n.pron); gloss = n.pron === 'DEM' ? 'cela' : n.pron; }
      else if (n.head && n.head.k === 'NAME') { head = n.head.text; gloss = 'nom propre'; }
      else if (n.head) { head = root(n.head.c, n.head.coined); gloss = n.head.c.replace(/^x:/, ''); }
      var adjs = n.adjs.map(function (a) {
        var list = [];
        if (a.int) list.push(W(L.form(a.int), a.int));
        list.push(W(root(a.c, a.coined), a.c.replace(/^x:/, ''), { coined: a.coined }));
        return list;
      });
      if (!head) { adjs.forEach(function (a) { words = words.concat(a); }); return words; }
      var isName = n.head && n.head.k === 'NAME', mark = !n.pron && !isName;
      if (n.pl && mark) {
        if (G.plural === 'suffixe') { head += L.form('PL'); gloss += '-PL'; }
        else if (G.plural === 'préfixe') { head = L.form('PL') + head; gloss = 'PL-' + gloss; }
        else if (G.plural === 'redoublement') { var seg = Lang.segment(head), cut = 0; while (cut < seg.length && !isV(seg[cut])) cut++; head = seg.slice(0, cut + 1).join('') + head; gloss = 'PL~' + gloss; }
      }
      if (n.det.def && mark && G.def === 'suffixe') { head += L.form('DEF'); gloss += '-DÉF'; }
      if (role === 'O' && G.caseAcc) { head += L.form('ACC'); gloss += '-ACC'; }
      var headW = [W(head, gloss, { coined: n.head && n.head.coined, name: isName })];
      if (n.pl && mark && G.plural === 'particule') headW.push(W(L.form('PL'), 'PL'));
      var pre = [], post = [];
      if (n.det.def && mark && G.def === 'mot avant') pre.push(W(L.form('DEF'), 'DÉF'));
      if (n.det.def && mark && G.def === 'mot après') post.push(W(L.form('DEF'), 'DÉF'));
      var mods = [];
      if (n.det.num !== undefined) mods.push([W(L.num(n.det.num), String(n.det.num))]);
      mods = mods.concat(adjs);
      if (n.det.dem) mods.push([W(L.form('DEM'), 'ce')]);
      var flat = []; mods.forEach(function (m) { flat = flat.concat(m); });
      var poss = n.det.poss ? [W(L.form(n.det.poss), n.det.poss + '.POSS')] : [];
      words = G.adjAfter ? pre.concat(headW, flat, post) : pre.concat(flat, headW, post);
      words = G.possAfter ? words.concat(poss) : poss.concat(words);
      if (n.gen) {
        var owner = np(n.gen, 'G'), link = [W(L.form('GEN'), 'de')];
        words = G.genAfter ? words.concat(link, owner) : owner.concat(link, words);
      }
      return words;
    }

    function clause(chunks, question) {
      var vi = -1, i;
      for (i = 0; i < chunks.length; i++) if (chunks[i].k === 'VG') { vi = i; break; }
      var lead = [], S = [], O = [], X = [], A = [], Vw = [];
      var listNP = function (list, role) { var w = []; list.forEach(function (c) { w = w.concat(c.k === 'NP' ? np(c, role) : c.k === 'CONJ' ? [W(L.form(c.c), c.c)] : []); }); return w; };
      if (vi < 0) {
        chunks.forEach(function (c) {
          if (c.k === 'NP') lead = lead.concat(np(c, 'S'));
          else if (c.k === 'PP') lead = lead.concat(pp(c));
          else if (c.k === 'CONJ' || c.k === 'ADV' || c.k === 'WH' || c.k === 'INT') lead.push(W(L.form(c.c), c.c));
        });
        if (question) lead = G.qEnd ? lead.concat([W(L.form('Q'), 'Q')]) : [W(L.form('Q'), 'Q')].concat(lead);
        return lead;
      }
      var vg = chunks[vi], subj = [], objs = [];
      chunks.slice(0, vi).forEach(function (c) {
        if (c.k === 'NP' && c.obj) objs.push(c);
        else if (c.k === 'NP' || c.k === 'CONJ' && subj.length) subj.push(c);
        else if (c.k === 'PP') X = X.concat(pp(c));
        else if (c.k === 'ADV') A.push(W(L.form(c.c), c.c));
        else if (c.c) lead.push(W(L.form(c.c), c.c));
      });
      while (subj.length && subj[subj.length - 1].k === 'CONJ') subj.pop();
      chunks.slice(vi + 1).forEach(function (c) {
        if (c.k === 'NP' || c.k === 'CONJ' && objs.length) objs.push(c);
        else if (c.k === 'PP') X = X.concat(pp(c));
        else if (c.k === 'ADV') A.push(W(L.form(c.c), c.c));
        else if (c.k === 'VG') Vw.push(W(root(c.verbs[c.verbs.length - 1].c, c.verbs[c.verbs.length - 1].coined), c.verbs[c.verbs.length - 1].c.replace(/^x:/, '')));
        else if (c.c) lead.push(W(L.form(c.c), c.c));
      });

      if (!subj.length && question && objs.length && objs[0].pron && !objs[0].obj) subj.push(objs.shift());

      // Temps
      var verbs = vg.verbs.slice(), tense = 'pres', first = verbs[0];
      if (verbs.length > 1 && (first.c === 'avoir' || first.c === 'être') && first.t === 'pres' && (verbs[1].t === 'part' || (verbs[1].alt || []).some(function (a) { return a.t === 'part'; })) && (first.c === 'avoir' || MOTION.indexOf(verbs[1].c) >= 0 || verbs[1].coined)) { verbs.shift(); tense = 'past'; }
      else if (verbs.length > 1 && first.c === 'aller' && first.t === 'pres' && verbs[1].t === 'inf') { verbs.shift(); tense = 'fut'; }
      else if (first.t === 'fut') tense = 'fut';
      else if (first.t === 'past') tense = 'past';
      var main = verbs[0], copula = main.c === 'être' && verbs.length === 1;
      var person = subj.length === 1 && subj[0].pron && subj[0].pron !== 'DEM' ? subj[0].pron : (subj.length > 1 || subj[0] && subj[0].pl ? '3PL' : '3SG');
      var imperative = !subj.length && !question && main.c !== 'exister' && tense === 'pres';

      S = listNP(subj, 'S');
      O = listNP(objs, copula ? 'P' : 'O');
      if (copula && !G.copula && tense === 'pres' && !vg.neg) {
        notes.push('Cette langue n\'a pas de verbe « être » au présent : on juxtapose simplement les deux termes.');
      } else {
        var v = root(main.c, main.coined), gl = main.c.replace(/^x:/, ''), parts = [], tkey = tense === 'past' ? 'PAST' : 'FUT', tgl = tense === 'past' ? 'PASSÉ' : 'FUT';
        if (tense !== 'pres') {
          if (G.tense === 'suffixe') { v += L.form(tkey); gl += '-' + tgl; }
          else if (G.tense === 'préfixe') { v = L.form(tkey) + v; gl = tgl + '-' + gl; }
        }
        if (G.agree && !imperative) { v += L.form('A' + person); gl += '-' + person; }
        if (imperative) { v += L.form('IMP'); gl += '-IMPÉR'; }
        if (vg.neg && G.neg === 'suffixe') { v += L.form('NEG'); gl += '-NÉG'; }
        if (tense !== 'pres' && G.tense === 'particule avant') parts.push(W(L.form(tkey), tgl));
        if (vg.neg && G.neg === 'particule avant') parts.push(W(L.form('NEG'), 'NÉG'));
        parts.push(W(v, gl, { coined: main.coined }));
        if (vg.neg && G.neg === 'particule après') parts.push(W(L.form('NEG'), 'NÉG'));
        if (tense !== 'pres' && G.tense === 'particule après') parts.push(W(L.form(tkey), tgl));
        var extra = verbs.slice(1).map(function (x) { return W(root(x.c, x.coined), x.c.replace(/^x:/, ''), { coined: x.coined }); });
        Vw = G.vFinal ? extra.concat(Vw, parts) : parts.concat(extra, Vw);
      }
      var res = lead.slice(), slots = { S: S, O: O, V: G.vFinal ? X.concat(A, Vw) : Vw.concat(A) };
      G.order.split('').forEach(function (k) { res = res.concat(slots[k]); });
      if (!G.vFinal) res = res.concat(X);
      if (question) res = G.qEnd ? res.concat([W(L.form('Q'), 'Q')]) : [W(L.form('Q'), 'Q')].concat(res);
      return res;
    }
    function pp(c) {
      var inner = np(c.np, 'X'), p = [W(L.form(c.prep), c.prep)];
      return G.postp ? inner.concat(p) : p.concat(inner);
    }

    for (var s = 0; s < sentences.length; s += 2) {
      var body = sentences[s], punct = sentences[s + 1] || '';
      var tokens = body.match(/[a-zA-Zàâäçéèêëîïôöùûüœ]+'?|\d+/gi);
      if (!tokens) continue;
      var items = classify(L, tokens), question = /\?/.test(punct);
      if (items.some(function (x) { return x.k === 'Q'; })) { question = true; items = items.filter(function (x) { return x.k !== 'Q'; }); }
      var chunks = chunk(items), group = [], words = [];
      // Découpage en propositions : une conjonction suivie d'un nouveau verbe ouvre une proposition
      for (var c = 0; c < chunks.length; c++) {
        var ch = chunks[c];
        if (ch.k === 'CONJ' && group.some(function (x) { return x.k === 'VG'; })) {
          var later = false;
          for (var k = c + 1; k < chunks.length && chunks[k].k !== 'CONJ'; k++) if (chunks[k].k === 'VG') later = true;
          if (later) { words = words.concat(clause(group, false)); group = [ch]; continue; }
        }
        group.push(ch);
      }
      words = words.concat(clause(group, question));
      if (words.length) out.push({ words: words, punct: punct.charAt(0) || '' });
    }
    var uniq = notes.filter(function (n, i) { return notes.indexOf(n) === i; });
    return {
      sentences: out, notes: uniq,
      text: out.map(function (sn) { return cap(sn.words.map(function (w) { return w.w; }).join(' ')) + (sn.punct || '.'); }).join(' ')
    };
  }

  // ---------- Résumé de la grammaire ----------
  Lang.describe = function (L) {
    var G = L.G, names = { S: 'sujet', O: 'objet', V: 'verbe' };
    var ex = function (fr) { return L.translate(fr).text; };
    return [
      ['Ordre des mots', G.order.split('').map(function (k) { return names[k]; }).join(' – '), 'Le chasseur voit la bête.'],
      ['Adjectif', G.adjAfter ? 'après le nom' : 'avant le nom', 'Une grande maison.'],
      ['Pluriel', G.plural === 'aucun' ? 'non marqué, le contexte suffit' : G.plural === 'redoublement' ? 'on redouble le début du mot' : G.plural === 'particule' ? 'un petit mot après le nom' : G.plural + ' sur le nom', 'Les arbres.'],
      ['Article défini', G.def === 'aucun' ? 'il n\'y en a pas' : G.def === 'suffixe' ? 'collé à la fin du nom' : G.def, 'Le soleil.'],
      ['Objet du verbe', G.caseAcc ? 'marqué par une terminaison (accusatif)' : 'reconnu par sa place dans la phrase', 'Je mange le poisson.'],
      ['Temps', 'présent nu ; passé et futur par ' + (G.tense === 'suffixe' || G.tense === 'préfixe' ? G.tense : 'une ' + G.tense.replace('avant', 'avant le verbe').replace('après', 'après le verbe')), 'Nous avons chanté. Nous chanterons.'],
      ['Accord du verbe', G.agree ? 'le verbe prend une terminaison selon la personne' : 'le verbe ne change jamais selon la personne', 'Tu marches. Ils marchent.'],
      ['Négation', G.neg === 'suffixe' ? 'une terminaison sur le verbe' : 'une ' + G.neg.replace('avant', 'avant le verbe').replace('après', 'après le verbe'), 'Il ne dort pas.'],
      ['Verbe « être »', G.copula ? 'il existe' : 'absent au présent', 'Le ciel est rouge.'],
      ['Possession', (G.possAfter ? 'possessif après le nom' : 'possessif avant le nom') + ' ; ' + (G.genAfter ? 'possesseur après' : 'possesseur avant'), 'La maison de mon père.'],
      ['Lieu', G.postp ? 'postpositions, placées après le nom' : 'prépositions, placées avant le nom', 'Dans la forêt.'],
      ['Question', 'une particule ' + (G.qEnd ? 'en fin' : 'en début') + ' de phrase', 'Tu viens ?'],
      ['Nombres', 'on compte en base ' + G.base, G.base + ' enfants. ' + (G.base * 2 + 3) + ' étoiles.']
    ].map(function (row) { return { name: row[0], rule: row[1], fr: row[2], ex: ex(row[2]) }; });
  };

  // ---------- Mots propres à un monde (appelé par la Fabrique quand elle est reliée à l'Atlas) ----------
  Lang.worldWords = function (L, w) {
    var out = [], G = L.G;
    var compound = function (a, b) { return G.adjAfter ? L.form(a) + L.form(b) : L.form(b) + L.form(a); };
    var none = function (c, why) { L.missing[c] = why; out.push({ fr: c, word: null, note: 'aucun mot : ' + why }); };
    var add = function (fr, word, note) { out.push({ fr: fr, word: word, note: note }); };
    if (w.aquatic) none('feu', 'le feu n\'existe pas sous l\'eau');
    if (w.moons === 0) none('lune', 'ce monde n\'a pas de lune');
    else if (w.moons >= 2) { add('la grande lune', compound('lune', 'grand'), 'chaque lune a son nom'); add('la petite lune', compound('lune', 'petit'), 'littéralement « lune petite »'); }
    if (w.tilt <= 6) { none('saison', 'le climat ne change pas au fil de l\'année'); none('hiver', 'il n\'y a pas de saison froide'); none('été', 'il n\'y a pas de saison chaude'); }
    else if (w.tilt >= 28) add('la grande migration', compound('chemin', 'saison'), 'le voyage que le peuple refait à chaque changement de saison');
    if (w.tech === 0) none('ville', 'ce peuple ne connaît que le campement');
    if (w.T < 5 || w.ice > 0.2) { add('neige fraîche', compound('neige', 'nouveau'), 'trois mots courants là où nous disons « neige »'); add('neige durcie', compound('neige', 'dur'), 'celle qui porte le poids d\'un marcheur'); add('glace de mer', compound('glace', 'mer'), 'la banquise, sur laquelle on chasse'); }
    if (w.liquid > 0.6 || w.aquatic) { add('mer calme', compound('mer', 'doux'), 'l\'état de la mer se dit en un seul mot'); add('grande houle', compound('mer', 'fort'), 'littéralement « mer forte »'); add('le large', compound('mer', 'profond'), 'là où l\'on ne voit plus le fond'); }
    if (w.dry > 0.15) { add('vent de sable', compound('vent', 'sable'), 'le danger principal des terres sèches'); add('point d\'eau', compound('eau', 'œil'), 'littéralement « œil d\'eau »'); }
    if (w.dayH >= 40) add('sieste de midi', compound('nuit', 'petit'), 'littéralement « petite nuit », le repos au plus chaud du long jour');
    if (w.star === 'M') add('la couleur de la chaleur', L.form('§infrarouge'), 'une couleur de plus que nous : celle de l\'infrarouge, que ce peuple voit');
    if (w.g >= 1.35) add('tomber', L.form('tomber'), 'le même mot signifie aussi « mourir de vieillesse » : ici, une chute ne pardonne pas');
    return out;
  };

  Lang.CONCEPTS = CONCEPTS;
})();
