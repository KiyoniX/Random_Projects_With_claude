// Stèles : les inscriptions à déchiffrer, tirées des Chroniques d'un monde.
// Chaque événement de l'histoire devient une stèle gravée dans la langue de son époque, enfouie dans la cité où il a eu lieu.
(function () {
  'use strict';

  var Steles = window.Steles = {};
  var MARK = /^(PL|DÉF|ACC|PASSÉ|FUT|IMPÉR|NÉG|[123](SG|PL))$/;

  // Reliefs sculptés à côté du texte : seuls indices sur le sens des mots
  var ICONS = Steles.ICONS = {
    soleil: '☀️', lune: '🌙', 'étoile': '⭐', ciel: '☁️', eau: '💧', mer: '🌊', 'rivière': '🏞️', pluie: '🌧️', neige: '❄️', feu: '🔥', pierre: '🪨', montagne: '⛰️',
    'forêt': '🌲', herbe: '🌿', nuit: '🌑', 'lumière': '✨', 'désert': '🏜️', saison: '🍂', 'été': '🌞', jour: '🌅', terre: '🌱', an: '⏳',
    peuple: '👥', roi: '👑', reine: '👸', chef: '🪶', enfant: '🧒', 'frère': '👬', 'père': '👴', dieu: '🛐', chasseur: '🏹', guerrier: '⚔️',
    sang: '🩸', 'bête': '🐾', poisson: '🐟', maison: '🏠', village: '🛖', ville: '🏛️', mot: '💬', langue: '👅', histoire: '📜', bateau: '⛵',
    porte: '🚪', mort: '💀', paix: '🕊️', peau: '✋',
    'bâtir': '🧱', prier: '🙏', tuer: '🗡️', 'écrire': '✍️', compter: '🧮', cultiver: '🌾', marcher: '👣', manger: '🍽️', voler: '🦅', donner: '🎁', trouver: '🔍',
    rouge: '🔴', jaune: '🟡', blanc: '⚪'
  };

  Steles.build = function (w, h) {
    var PG = window.PG, Lang = window.Lang, L = w.people.lang, stages = {};
    var rng = PG.rng('stèles' + w.seed);
    var content = {};
    Lang.CONCEPTS.forEach(function (c) { if (c.pos === 'nom' || c.pos === 'adj.' || c.pos === 'verbe') content[c.fr] = c.pos; });

    // Langue de l'époque, comme dans les Chroniques
    var stageOf = function (year) {
      var n = year < 250 ? 4 : year < 500 ? 3 : year < 750 ? 2 : year < 900 ? 1 : 0;
      if (!n) return L;
      return stages[n] || (stages[n] = L.derive('archaïque', n));
    };

    // Noms propres : cités et souverains
    var names = {};
    h.cities.forEach(function (c, i) { names[c.name] = { city: i }; });
    h.polities.forEach(function (pol) { pol.rulers.forEach(function (r) { if (!names[r.name]) names[r.name] = { ruler: r }; }); });
    // Le traducteur coupe les noms qui contiennent une apostrophe (« La'e ») : on les lui passe sous un alias
    // Un souverain peut s'appeler « Une » : en tête de phrase, c'est un nom s'il est suivi de « a »
    var alias = {}, real = {}, START = /^(Le|La|Les|Un|Une|Nous|Beaucoup|Deux)$/;
    Object.keys(names).forEach(function (n, i) { var a = 'Zz' + String.fromCharCode(97 + Math.floor(i / 26), 97 + i % 26); alias[n] = a; real[a] = n; });
    var masked = function (fr) {
      return fr.split(/([ .,;:!?]+)/).map(function (t, i, all) { return alias[t] && !(i === 0 && START.test(t) && all[2] !== 'a') ? alias[t] : t; }).join('');
    };
    var template = function (fr) { return masked(fr).replace(/Zz[a-z]{2}/g, '§').replace(/\d+/g, '#'); };

    function wordsOf(e) {
      var out = [];
      stageOf(e.year).translate(masked(e.fr)).sentences.forEach(function (sn) {
        sn.words.forEach(function (x) {
          var o = { w: x.w.toLowerCase(), segs: Lang.segment(x.w), gloss: x.g };
          if (x.name) {
            var nm = real[x.w.slice(0, 4)] || x.w, rest = real[x.w.slice(0, 4)] ? x.w.slice(4) : '';
            o.kind = 'nom'; o.name = nm; o.key = 'nom:' + nm; o.w = (nm + rest).toLowerCase();
            o.n = Lang.segment(nm).length; o.segs = Lang.segment(nm).concat(Lang.segment(rest));
          } else {
            var parts = x.g.split(/[-~]/).filter(function (p) { return !MARK.test(p); });
            if (parts.length === 1 && (x.coined || content[parts[0]])) { o.kind = 'mot'; o.concept = o.key = parts[0]; }
            else { o.kind = 'outil'; o.key = 'outil:' + x.g; }
          }
          if (o.segs.length) out.push(o);
        });
      });
      return out;
    }

    // Une stèle par événement ; les redites sont écartées, sauf si la cité n'a encore rien livré
    var living = h.cities.filter(function (c) { return !c.lost; });
    var steles = [], sites = {}, seen = {}, concepts = {}, sounds = {};
    h.events.forEach(function (e) {
      // Les fléaux ont frappé tout le peuple : leurs stèles se trouvent dans n'importe quelle cité de l'époque
      var city = e.where && e.type !== 'nature' ? e.where.at || (/^Abandon/.test(e.title) ? e.where.from : e.where.to) : null;
      if (!city) { var old = living.filter(function (c) { return c.founded <= e.year; }); city = old[Math.floor(rng() * old.length)] || h.cities[0]; }
      var idx = h.cities.indexOf(city), key = template(e.fr), first = !steles.length;
      if (!first && sites[idx] && seen[key]) return;
      seen[key] = true;
      var st = { id: steles.length, event: e, site: idx, words: wordsOf(e), bilingual: first, concepts: [], icons: [] };
      st.words.forEach(function (x) {
        x.segs.forEach(function (s) { sounds[s] = true; });
        if (x.kind === 'mot' && st.concepts.indexOf(x.concept) < 0) { st.concepts.push(x.concept); concepts[x.concept] = content[x.concept] || 'nom'; }
      });
      // Deux reliefs au plus, tirés des mots de la stèle
      var pool = st.concepts.filter(function (c) { return ICONS[c]; });
      while (pool.length && st.icons.length < 2) st.icons.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      (sites[idx] = sites[idx] || []).push(st.id);
      steles.push(st);
    });

    var order = { nom: 0, verbe: 1, 'adj.': 2 };
    return {
      steles: steles, names: names, capital: steles[0].site,
      sites: Object.keys(sites).map(function (i) { return { idx: +i, city: h.cities[+i], steles: sites[i] }; }),
      concepts: Object.keys(concepts).map(function (c) { return { fr: c, pos: concepts[c], icon: ICONS[c] || '' }; })
        .sort(function (a, b) { return order[a.pos] - order[b.pos] || a.fr.localeCompare(b.fr, 'fr'); }),
      sounds: Object.keys(sounds).sort(function (a, b) { return a.localeCompare(b, 'fr'); }),
      known: living.map(function (c) { return c.name; })
    };
  };
})();
