// Le vivant : langue, flore, faune, peuple et cités, déduits du climat de la planète.
(function () {
  'use strict';

  var PG = window.PG, B = PG.B, W = PG.W, H = PG.H, clamp = PG.clamp, mix = PG.mix;
  var rgb = PG.rgb = function (c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; };
  var fr = function (n, d) { return n.toLocaleString('fr-FR', { maximumFractionDigits: d === undefined ? 1 : d }); };

  PG.big = function (n) {
    if (n < 1000) return fr(Math.max(1, Math.round(n)), 0);
    var units = [[1e12, 'billion'], [1e9, 'milliard'], [1e6, 'million'], [1e3, 'millier']];
    for (var i = 0; i < units.length; i++) {
      if (n >= units[i][0]) {
        var v = n / units[i][0];
        return fr(v, v >= 100 ? 0 : 1) + ' ' + units[i][1] + (v >= 2 ? 's' : '');
      }
    }
  };

  // « 4,1 milliards d'individus », « 4 500 habitants »
  PG.count = function (n, noun) {
    if (n < 1e6) {
      var p = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.max(1, n))) - 1));
      return fr(Math.max(1, Math.round(n / p) * p), 0) + ' ' + noun;
    }
    return PG.big(n) + (/^[aeiouh]/.test(noun) ? ' d\'' : ' de ') + noun;
  };

  // ---------- Langue de la planète ----------
  PG.makeLang = function (rng) {
    var C = ['p', 't', 'k', 'b', 'd', 'g', 'm', 'n', 'l', 'r', 's', 'z', 'v', 'f', 'h', 'ch', 'th', 'kh', 'sh', 'y', 'w', 'x'];
    var V = ['a', 'e', 'i', 'o', 'u', 'é', 'ou', 'ai', 'ia', 'eo'];
    var pick = function (arr, n) {
      var pool = arr.slice(), out = [];
      while (out.length < n) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      return out;
    };
    var cons = pick(C, 8), vow = pick(V, 4), ends = pick(['n', 'r', 's', 'l', 'k', 'th', 'm'], 3);
    return {
      word: function (r, min, max) {
        var n = min + Math.floor(r() * (max - min + 1)), w = '';
        for (var i = 0; i < n; i++) {
          w += (i > 0 || r() < 0.8 ? cons[Math.floor(r() * cons.length)] : '') + vow[Math.floor(r() * vow.length)];
          if (r() < (i === n - 1 ? 0.45 : 0.12)) w += ends[Math.floor(r() * ends.length)];
        }
        return w.charAt(0).toUpperCase() + w.slice(1);
      }
    };
  };

  // ---------- Flore ----------
  var FLORA = {};
  FLORA[B.DEEP] = 'plancton dérivant en nappes immenses';
  FLORA[B.SHALLOW] = 'forêts d\'algues géantes ancrées au fond';
  FLORA[B.SEA_ICE] = 'tapis d\'algues accrochés sous la glace';
  FLORA[B.ICE] = 'algues des neiges qui teintent la glace';
  FLORA[B.TUNDRA] = 'lichens et plantes en coussin au ras du sol';
  FLORA[B.TAIGA] = 'conifères en flèche qui laissent glisser la neige';
  FLORA[B.COLD_STEPPE] = 'herbes rases à racines profondes';
  FLORA[B.FOREST] = 'grands arbres à large couronne';
  FLORA[B.GRASS] = 'hautes herbes qui repoussent après chaque feu';
  FLORA[B.ARID] = 'buissons épineux et plantes grasses';
  FLORA[B.DESERT] = 'succulentes gorgées d\'eau, armées d\'épines';
  FLORA[B.SAVANNA] = 'arbres parasols épars au milieu des herbes';
  FLORA[B.JUNGLE] = 'arbres géants étagés, lianes et plantes perchées';
  FLORA[B.MOUNTAIN] = 'plantes en coussin blotties entre les rochers';

  function makeFlora(pl, st, rng, lang) {
    var prm = pl.prm, g = pl.g, id = st.id, notes = [];
    if (id >= 3) notes.push('feuillage ' + pl.star.vegName + ' pour capter la lumière de la ' + pl.star.name);
    if (id === B.FOREST || id === B.JUNGLE || id === B.TAIGA) {
      var h = Math.round((id === B.JUNGLE ? 55 : 35) / g);
      notes.push(g >= 1.3 ? 'troncs courts et massifs, ' + h + ' m au plus sous ' + fr(g) + ' g' : g <= 0.8 ? 'jusqu\'à ' + h + ' m de haut grâce à la faible gravité' : 'jusqu\'à ' + h + ' m de haut');
    }
    if (prm.tilt >= 28 && id === B.FOREST && st.lat > 25) notes.push('perd ses feuilles à la saison froide');
    if (prm.P >= 2.2 && id >= 4) notes.push('graines portées très loin par l\'air dense');
    if (prm.P <= 0.45 && id >= 4) notes.push('feuilles épaisses pour limiter l\'évaporation dans l\'air ténu');
    return { name: lang.word(rng, 2, 3), form: FLORA[id], notes: notes.slice(0, 3) };
  }

  // ---------- Faune ----------
  function makeAnimal(pl, st, role, rng, lang) {
    var prm = pl.prm, g = pl.g, P = prm.P, T = st.T, m = st.M, id = st.id, star = prm.star;
    var aquatic = id === B.DEEP || id === B.SHALLOW, ice = id === B.SEA_ICE, sapient = role === 'sapient';
    var aerial = !aquatic && !ice && !sapient && P >= 0.5 && rng() < clamp(0.15 + 0.2 * (P - 1) + 0.3 * (1 - g), 0.03, 0.7);
    var pred = role === 'pred';
    var A = [], add = function (cause, effect) { A.push({ cause: cause, effect: effect }); };

    // Masse
    var mass;
    if (sapient) mass = 65 / Math.pow(g, 0.8) * (T < 0 ? 1.3 : 1);
    else if (aquatic) mass = Math.pow(10, rng() * 4.4 - 1) * (pred ? 1 : 3);
    else if (aerial) mass = clamp(Math.pow(10, rng() * 1.8 - 1.5) * P / (g * g), 0.02, 90);
    else mass = Math.pow(10, rng() * 3.2 - 0.7) * (pred ? 1 : 3) * (1 + Math.max(0, 10 - T) / 15) / Math.pow(g, 1.5);

    var t = {
      kind: aquatic ? 'aquatic' : sapient ? 'upright' : aerial ? 'aerial' : 'land',
      stock: clamp(0.8 + 0.55 * (g - 1) + (T < 0 ? 0.25 : 0), 0.6, 1.7),
      legLen: clamp(36 / Math.pow(g, 0.9) * (T < -5 ? 0.75 : T > 28 ? 1.15 : 1), 12, 56),
      tall: clamp(1 / Math.pow(g, 0.6), 0.6, 1.45),
      legs: 0, fur: 0, scales: false, ears: 7, eyes: 3, hump: false, sail: false,
      tail: 10 + rng() * 30, wings: 0, glow: false,
      horns: !pred && !sapient && rng() < 0.5, stripes: rng() < 0.4
    };
    var habits = aquatic ? (pred ? ['chasse en groupe en encerclant les bancs', 'embusqué dans les rochers, frappe en un éclair', 'poursuit ses proies sur des kilomètres']
        : ['nage en bancs de plusieurs milliers', 'broute le fond en lentes processions', 'filtre l\'eau, bouche grande ouverte'])
      : aerial ? ['niche en colonies sur les falaises', 'ne se pose presque jamais, dort en vol', 'suit les troupeaux pour se nourrir de leurs parasites']
      : pred ? ['chasse en meute coordonnée', 'chasse à l\'affût, immobile pendant des heures', 'solitaire, défend un territoire immense', 'charognard autant que chasseur']
      : ['vit en troupeaux de plusieurs centaines', 'creuse des terriers reliés en véritables villes', 'solitaire, ne se regroupe que pour se reproduire', 'se déplace en file derrière une meneuse'];
    var habit = habits[Math.floor(rng() * habits.length)];

    // Gravité
    if (aquatic) {
      if (g >= 1.35 && mass > 200) add('Gravité ' + fr(g) + ' g', 'l\'eau le porte : il atteint une taille impossible sur la terre ferme');
    } else if (sapient) {
      t.legs = g >= 1.5 ? 4 : 2;
      if (g >= 1.35) add('Gravité ' + fr(g) + ' g', 'corps trapu' + (t.legs === 4 ? ', quatre jambes pour porter son poids' : ' et jambes épaisses'));
      else if (g <= 0.8) add('Gravité ' + fr(g) + ' g', 'silhouette longue et fine, démarche bondissante');
    } else if (aerial) {
      t.legs = 2;
      t.wings = clamp(52 * Math.sqrt(g) / Math.sqrt(P), 26, 78);
      add('Air à ' + fr(P) + ' bar, ' + fr(g) + ' g', P >= 1.8 ? 'vole avec de petites ailes, l\'air dense le porte' : g <= 0.8 ? 'plane des heures sans effort sous cette faible gravité' : 'vole grâce à de grandes ailes');
    } else if (g >= 1.35) {
      t.legs = rng() < 0.5 ? 6 : 8;
      add('Gravité ' + fr(g) + ' g', t.legs + ' pattes courtes et épaisses, squelette dense, ne saute jamais');
    } else if (g <= 0.8) {
      t.legs = rng() < 0.3 ? 2 : 4;
      add('Gravité ' + fr(g) + ' g', 'longues pattes fines, bonds de ' + Math.round(4 / g) + ' m');
    } else t.legs = rng() < 0.2 ? 6 : 4;

    // Température
    var deg = fr(T, 0) + ' °C';
    if (aquatic) {
      if (T < 4) add('Eau à ' + deg, 'épaisse couche de graisse, sang chargé d\'antigel');
      else if (T > 28) add('Eau à ' + deg, 'eau pauvre en oxygène : branchies immenses, vie au ralenti');
    } else if (T < -8) {
      t.fur = 2; t.ears = 3;
      add('Froid, ' + deg, 'fourrure dense, graisse, oreilles et queue minuscules' + (T < -18 ? ', antigel dans le sang' : ''));
    } else if (T < 10) {
      t.fur = 1;
      add('Climat frais, ' + deg, 'pelage qui s\'épaissit en saison froide');
    } else if (T > 28) {
      t.ears = 22;
      if (m < 0.35) {
        t.scales = true; t.sail = rng() < 0.6;
        add('Chaleur sèche, ' + deg, 'écailles claires, grandes oreilles' + (t.sail ? ' et voile dorsale' : '') + ' pour évacuer la chaleur, actif la nuit');
      } else add('Chaleur humide, ' + deg, 'peau nue, grandes oreilles, bains de boue aux heures chaudes');
    } else if (T > 18) t.ears = 12;
    if (ice) { t.fur = 2; add('Banquise', 'chasse sous la glace et y perce des trous pour respirer'); }

    // Eau disponible
    if (!aquatic && !ice) {
      if (m < 0.25 && T > 5) { t.hump = !aerial && !sapient; add('Humidité ' + Math.round(m * 100) + ' %', 'réserve d\'eau et de graisse' + (t.hump ? ' dans une bosse' : '') + ', boit rarement'); }
      else if (m > 0.65) add('Humidité ' + Math.round(m * 100) + ' %', 'peau perméable, pattes palmées, pond dans l\'eau');
    }

    // Atmosphère
    if (!aquatic) {
      if (P <= 0.45) add('Air ténu, ' + fr(P) + ' bar', 'cage thoracique énorme, sang très riche en pigments');
      else if (P >= 2.2 && !aerial) add('Air dense, ' + fr(P) + ' bar', 'petits poumons ; les sons portent loin, il communique par appels graves');
    }

    // Lumière
    if (id === B.DEEP) { t.glow = true; t.eyes = 5.5; add('Abysses sans lumière', 'organes lumineux pour attirer proies et partenaires'); }
    else if (star === 'M') { t.eyes = 5.5; add('Lumière rouge de la ' + pl.star.name, 'yeux énormes sensibles à l\'infrarouge'); }
    else if (star === 'F' && !aquatic) add('Ultraviolets de l\'' + pl.star.name, 'peau très pigmentée et paupières teintées');

    // Saisons et jour
    if (!aquatic) {
      if (prm.tilt >= 28 && st.lat > 25) add('Inclinaison ' + prm.tilt + '°', pred ? 'hiberne pendant la saison froide' : aerial || !sapient ? 'migre sur des milliers de kilomètres au fil des saisons' : 'vit au rythme de saisons très marquées');
      else if (prm.tilt <= 6) add('Inclinaison ' + prm.tilt + '°', 'aucune saison : se reproduit toute l\'année');
      if (prm.dayH >= 40) add('Jour de ' + prm.dayH + ' h', 'dort à midi et à minuit, actif aux deux crépuscules');
      else if (prm.dayH <= 11) add('Jour de ' + prm.dayH + ' h', 'sommeil haché en courtes siestes');
    }

    // Couleur : camouflage dans le biome
    var base = PG.palette(pl.star)[id], color;
    if (ice || id === B.ICE) color = [232, 236, 240];
    else if (aquatic) color = mix(id === B.DEEP ? [40, 50, 80] : [80, 140, 170], [rng() * 255, rng() * 255, rng() * 255], 0.25);
    else {
      color = mix(base, [130, 105, 85], 0.3);
      if (id === B.JUNGLE && rng() < 0.4) { color = mix([240, 80, 60], [250, 210, 40], rng()); add('Jungle dense', 'couleurs vives qui avertissent : sa chair est toxique'); }
      else if (!sapient && (id === B.FOREST || id === B.JUNGLE || id === B.TAIGA)) { color = mix(pl.star.veg, [130, 105, 85], 0.25); add('Feuillage ' + pl.star.vegName, 'pelage ' + pl.star.vegName + ' qui le rend presque invisible sous les arbres'); }
      else if (!sapient && id >= 4 && id !== B.MOUNTAIN) add('Milieu ouvert', 'pelage aux teintes du paysage, pour se fondre dans le décor');
    }
    color = color.map(function (c) { return clamp(c * (pred ? 0.8 : 1) + (rng() - 0.5) * 30, 15, 245); });
    t.color = color;

    var npp = PG.BIOMES[id].npp, dens = 60 * npp * Math.pow(mass, -0.75) * (pred ? 0.03 : 1);
    var roleName = sapient ? 'Espèce intelligente' :
      aquatic ? (pred ? 'Chasseur marin' : mass > 500 ? 'Filtreur géant' : 'Brouteur d\'algues') :
      aerial ? (pred ? 'Rapace' : 'Planeur') :
      ice ? (pred ? 'Chasseur des glaces' : 'Pêcheur des glaces') :
      pred ? 'Prédateur' : mass < 2 ? 'Rongeur' : 'Herbivore';

    return {
      name: lang.word(rng, 2, 3) + ' ' + PG.BIOMES[id].of, role: roleName, mass: mass,
      size: (sapient ? 1.7 * t.tall : 0.42 * Math.pow(mass, 1 / 3)),
      pop: dens * st.area, traits: t, habit: habit, adapt: A.slice(0, 5)
    };
  }

  // ---------- Dessin d'une créature ----------
  PG.drawCreature = function (t) {
    var col = rgb(t.color), dark = rgb(mix(t.color, [0, 0, 0], 0.45)), light = rgb(mix(t.color, [255, 255, 255], 0.4));
    var s = '', i, cx = 110, fuzz = function (x, y, rx, ry) {
      return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + (rx + 2) + '" ry="' + (ry + 2) + '" fill="none" stroke="' + dark + '" stroke-width="' + (t.fur * 3) + '" stroke-dasharray="1.5 3.5"/>';
    };
    var eye = function (x, y, r) {
      return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#fff"/><circle cx="' + (x + r * 0.2) + '" cy="' + y + '" r="' + r * 0.55 + '" fill="#111"/>';
    };

    if (t.kind === 'aquatic') {
      var cy = 72, rx = 44 + t.tail * 0.6, ry = clamp(rx * 0.3 * t.stock, 12, 30), tx = cx - rx;
      s += '<polygon points="' + (tx + 8) + ',' + cy + ' ' + (tx - 24) + ',' + (cy - 22) + ' ' + (tx - 14) + ',' + cy + ' ' + (tx - 24) + ',' + (cy + 22) + '" fill="' + dark + '"/>';
      s += '<path d="M' + (cx - 16) + ' ' + (cy - ry + 3) + ' q10 -26 30 -2 z" fill="' + dark + '"/>';
      s += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="' + col + '"/>';
      s += '<ellipse cx="' + cx + '" cy="' + (cy + ry * 0.45) + '" rx="' + rx * 0.8 + '" ry="' + ry * 0.4 + '" fill="' + light + '" opacity=".45"/>';
      s += '<ellipse cx="' + (cx + 14) + '" cy="' + (cy + ry * 0.5) + '" rx="16" ry="6" transform="rotate(28 ' + (cx + 14) + ' ' + (cy + ry * 0.5) + ')" fill="' + dark + '"/>';
      if (t.fur) s += fuzz(cx, cy, rx, ry);
      if (t.glow) for (i = 0; i < 6; i++) s += '<circle cx="' + (cx - 40 + i * 15) + '" cy="' + (cy - 2 + (i % 2) * 5) + '" r="2.6" fill="#9ff7ff"/><circle cx="' + (cx - 40 + i * 15) + '" cy="' + (cy - 2 + (i % 2) * 5) + '" r="6" fill="#9ff7ff" opacity=".25"/>';
      s += eye(cx + rx - 18, cy - 4, t.eyes);
    } else if (t.kind === 'upright') {
      var ground = 134, leg = t.legLen * 0.9, try_ = 22 * t.tall, trx = 11 * t.stock + 3, by = ground - leg - try_;
      var hy = by - try_ - 10;
      for (i = 0; i < t.legs; i++) {
        var lx = cx + (i - (t.legs - 1) / 2) * (t.legs === 4 ? 9 : 12);
        s += '<line x1="' + lx + '" y1="' + (by + try_ - 5) + '" x2="' + (lx + (i - (t.legs - 1) / 2) * 3) + '" y2="' + ground + '" stroke="' + (i % 2 ? col : dark) + '" stroke-width="' + (5 + 3 * t.stock) + '" stroke-linecap="round"/>';
      }
      s += '<line x1="' + (cx - trx * 0.8) + '" y1="' + (by - try_ * 0.55) + '" x2="' + (cx - trx - 12) + '" y2="' + (by + 10) + '" stroke="' + dark + '" stroke-width="' + (4 + 2 * t.stock) + '" stroke-linecap="round"/>';
      s += '<line x1="' + (cx + trx * 0.8) + '" y1="' + (by - try_ * 0.55) + '" x2="' + (cx + trx + 12) + '" y2="' + (by + 10) + '" stroke="' + dark + '" stroke-width="' + (4 + 2 * t.stock) + '" stroke-linecap="round"/>';
      s += '<ellipse cx="' + cx + '" cy="' + by + '" rx="' + trx + '" ry="' + try_ + '" fill="' + col + '"/>';
      s += '<ellipse cx="' + (cx - 13) + '" cy="' + (hy - 2) + '" rx="3.5" ry="' + (2 + t.ears * 0.55) + '" fill="' + dark + '"/><ellipse cx="' + (cx + 13) + '" cy="' + (hy - 2) + '" rx="3.5" ry="' + (2 + t.ears * 0.55) + '" fill="' + dark + '"/>';
      s += '<circle cx="' + cx + '" cy="' + hy + '" r="12" fill="' + col + '"/>';
      if (t.fur) s += fuzz(cx, by, trx, try_) + fuzz(cx, hy, 12, 12);
      s += eye(cx - 4.5, hy - 1, t.eyes * 0.75) + eye(cx + 4.5, hy - 1, t.eyes * 0.75);
    } else {
      var air = t.kind === 'aerial', gy = 132;
      var L = air ? 9 : t.legLen, bry = (air ? 12 : 19) * Math.sqrt(t.stock), brx = air ? 34 : 50 / Math.pow(t.stock, 0.25);
      var bcy = air ? 78 : gy - L - bry + 4, neck = air ? 8 : clamp(L * 0.45, 5, 24);
      var hx = cx + brx + neck * 0.55, hyy = bcy - neck * 0.75 - 2, hr = air ? 9 : 12;
      s += '<path d="M' + (cx - brx + 4) + ' ' + bcy + ' q' + (-t.tail) + ' ' + (-t.tail * 0.2) + ' ' + (-t.tail * 1.1) + ' ' + (t.tail * 0.35) + '" fill="none" stroke="' + dark + '" stroke-width="' + (air ? 7 : 5) + '" stroke-linecap="round"/>';
      if (air) {
        var ws = t.wings;
        s += '<path d="M' + (cx + 8) + ' ' + (bcy - 4) + ' Q' + (cx + 20) + ' ' + (bcy - ws * 1.1) + ' ' + (cx + ws * 0.9) + ' ' + (bcy - ws * 0.75) + ' Q' + (cx + 34) + ' ' + (bcy - 10) + ' ' + (cx + 8) + ' ' + (bcy + 2) + 'Z" fill="' + dark + '"/>';
      }
      for (i = 0; i < t.legs; i++) {
        var px = cx - brx * 0.68 + (t.legs > 1 ? i * (brx * 1.36) / (t.legs - 1) : brx * 0.68);
        s += '<line x1="' + px + '" y1="' + (bcy + bry * 0.55) + '" x2="' + (px + (i % 2 ? 3 : -3)) + '" y2="' + (bcy + bry * 0.55 + L + (air ? 0 : bry * 0.4)) + '" stroke="' + (i % 2 ? col : dark) + '" stroke-width="' + (air ? 3 : 4 + 4 * t.stock) + '" stroke-linecap="round"/>';
      }
      if (t.sail) s += '<path d="M' + (cx - brx * 0.6) + ' ' + (bcy - bry * 0.7) + ' Q' + cx + ' ' + (bcy - bry - 34) + ' ' + (cx + brx * 0.6) + ' ' + (bcy - bry * 0.7) + 'Z" fill="' + light + '" stroke="' + dark + '" stroke-width="1.5"/>';
      if (t.hump) s += '<ellipse cx="' + (cx - 6) + '" cy="' + (bcy - bry * 0.8) + '" rx="' + brx * 0.4 + '" ry="' + bry * 0.7 + '" fill="' + col + '"/>';
      s += '<line x1="' + (cx + brx * 0.7) + '" y1="' + (bcy - bry * 0.3) + '" x2="' + hx + '" y2="' + hyy + '" stroke="' + col + '" stroke-width="' + (air ? 8 : 9 + 5 * t.stock) + '" stroke-linecap="round"/>';
      s += '<ellipse cx="' + cx + '" cy="' + bcy + '" rx="' + brx + '" ry="' + bry + '" fill="' + col + '"/>';
      s += '<ellipse cx="' + cx + '" cy="' + (bcy + bry * 0.45) + '" rx="' + brx * 0.8 + '" ry="' + bry * 0.42 + '" fill="' + light + '" opacity=".35"/>';
      if (t.scales) for (i = 0; i < 9; i++) s += '<path d="M' + (cx - brx * 0.7 + i * brx * 0.17) + ' ' + (bcy - bry * 0.25 + (i % 2) * 6) + ' q4 5 8 0" fill="none" stroke="' + dark + '" stroke-width="1.4"/>';
      if (air) {
        var w2 = t.wings;
        s += '<path d="M' + (cx - 4) + ' ' + (bcy - 5) + ' Q' + (cx - 22) + ' ' + (bcy - w2 * 1.2) + ' ' + (cx - w2 * 1.05) + ' ' + (bcy - w2 * 0.6) + ' Q' + (cx - 36) + ' ' + (bcy - 6) + ' ' + (cx - 4) + ' ' + (bcy + 3) + 'Z" fill="' + light + '" stroke="' + dark + '" stroke-width="1.5"/>';
      }
      s += '<ellipse cx="' + (hx - 5) + '" cy="' + (hyy - hr * 0.7) + '" rx="4" ry="' + (2 + t.ears * 0.6) + '" transform="rotate(-18 ' + (hx - 5) + ' ' + (hyy - hr * 0.7) + ')" fill="' + dark + '"/>';
      s += '<circle cx="' + hx + '" cy="' + hyy + '" r="' + hr + '" fill="' + col + '"/>';
      if (t.stripes) for (i = 0; i < 5; i++) { var sx = cx - brx * 0.55 + i * brx * 0.27, sh = bry * Math.sqrt(1 - Math.pow((sx - cx) / brx, 2)) * 0.75; s += '<line x1="' + sx + '" y1="' + (bcy - sh) + '" x2="' + (sx - 3) + '" y2="' + (bcy + sh * 0.3) + '" stroke="' + dark + '" stroke-width="3" stroke-linecap="round" opacity=".7"/>'; }
      if (t.horns && !air) s += '<path d="M' + (hx + 2) + ' ' + (hyy - hr + 2) + ' q2 -14 10 -16 M' + (hx - 3) + ' ' + (hyy - hr + 2) + ' q0 -13 6 -17" fill="none" stroke="' + light + '" stroke-width="3" stroke-linecap="round"/>';
      if (air) s += '<polygon points="' + (hx + hr - 2) + ',' + (hyy - 2) + ' ' + (hx + hr + 10) + ',' + (hyy + 2) + ' ' + (hx + hr - 2) + ',' + (hyy + 5) + '" fill="' + dark + '"/>';
      if (t.fur) s += fuzz(cx, bcy, brx, bry) + fuzz(hx, hyy, hr, hr);
      s += eye(hx + hr * 0.35, hyy - 2, t.eyes * (air ? 0.8 : 1));
      if (t.glow) for (i = 0; i < 4; i++) s += '<circle cx="' + (cx - 24 + i * 16) + '" cy="' + (bcy - 2) + '" r="2.4" fill="#ffd9a0"/>';
    }
    return '<svg viewBox="' + (t.kind === 'upright' ? '50 14 120 126' : '0 0 220 140') + '" role="img" aria-label="Portrait de la créature">' + s + '</svg>';
  };

  // ---------- Peuple et cités ----------
  var TECH = [
    { name: 'Chasseurs-cueilleurs', dens: 0.05, cities: 3, urban: 0.02, word: 'campements' },
    { name: 'Villages agricoles', dens: 3, cities: 5, urban: 0.08, word: 'bourgs' },
    { name: 'Cités-États', dens: 15, cities: 6, urban: 0.15, word: 'cités' },
    { name: 'Âge industriel', dens: 45, cities: 8, urban: 0.5, word: 'métropoles' },
    { name: 'Ère spatiale', dens: 60, cities: 9, urban: 0.7, word: 'mégapoles' }
  ];

  // Berceau du peuple : la meilleure terre clémente, à défaut les mers peu profondes
  PG.homeOf = function (pl) {
    if (!pl.alive) return null;
    var suitable = pl.stats.filter(function (s) { return s.id >= 4 && !PG.BIOMES[s.id].dead && s.T > -8 && s.T < 36 && s.frac > 0; });
    var habit = suitable.reduce(function (a, s) { return a + s.frac; }, 0);
    if (habit >= 0.01) {
      var home = suitable.slice().sort(function (a, b) { return PG.BIOMES[b.id].npp * b.area - PG.BIOMES[a.id].npp * a.area; })[0];
      return { aquatic: false, home: home, suitable: suitable, habit: habit };
    }
    var sea = pl.stats[B.SHALLOW];
    return sea.frac >= 0.03 ? { aquatic: true, home: sea, suitable: [sea], habit: sea.frac } : null;
  };

  // Langue du monde : celle du peuple, façonnée par son milieu (moteur partagé avec la Fabrique de langues)
  PG.langFor = function (pl, seed) {
    if (!window.Lang) return PG.makeLang(PG.rng('langue' + seed));
    var h = pl ? PG.homeOf(pl) : null;
    if (!h) return window.Lang.create(seed);
    var id = h.home.id, T = h.home.T;
    return window.Lang.create(seed, {
      env: { aquatic: h.aquatic, T: T, M: h.home.M, P: pl.prm.P },
      medium: h.aquatic ? 'perles' : T < 8 || id === B.FOREST || id === B.TAIGA ? 'grave' : 'peinte'
    });
  };

  function makePeople(pl, seed, lang) {
    var rng = PG.rng('peuple' + seed), prm = pl.prm, g = pl.g;
    var h = PG.homeOf(pl);
    if (!h) return null;
    var suitable = h.suitable, habit = h.habit, aquatic = h.aquatic, home = h.home;

    var level = clamp(Math.floor(rng() * 5 * clamp(0.5 + habit * 2, 0.5, 1)), 0, aquatic ? 2 : 4);
    var tech = TECH[level];
    var capacity = suitable.reduce(function (a, s) { return a + s.area * (0.25 + PG.BIOMES[s.id].npp); }, 0);
    var total = capacity * tech.dens * (aquatic ? 0.3 : 1);
    var body = makeAnimal(pl, home, aquatic ? 'herb' : 'sapient', rng, lang);
    var name = lang.word(rng, 2, 3);

    // Emplacement des cités : terres clémentes, basses, proches des côtes
    var ok = {};
    suitable.forEach(function (s) { ok[s.id] = true; });
    var cand = [];
    for (var j = 12; j < H - 12; j += 3) {
      for (var i = 0; i < W; i += 3) {
        var k = j * W + i, b = pl.biome[k];
        if (!ok[b]) continue;
        var sc = PG.BIOMES[b].npp + 0.4 * (1 - Math.abs(pl.T[k] - 18) / 25) + rng() * 0.15;
        if (!aquatic) {
          sc -= pl.alt[k] / pl.Hmax * 0.8;
          var d = 5, coast = pl.biome[k - d] < 2 || pl.biome[k + d] < 2 || pl.biome[k - d * W] < 2 || pl.biome[k + d * W] < 2;
          if (coast) sc += 0.35;
        }
        cand.push({ i: i, j: j, sc: sc });
      }
    }
    cand.sort(function (a, b) { return b.sc - a.sc; });
    var cities = [];
    for (var c = 0; c < cand.length && cities.length < tech.cities; c++) {
      var p = cand[c], far = cities.every(function (q) {
        var dx = Math.abs(q.i - p.i); dx = Math.min(dx, W - dx) * pl.F.cosLat[p.j];
        return dx * dx + (q.j - p.j) * (q.j - p.j) > 46 * 46;
      });
      if (far) cities.push(p);
    }
    var harm = 0;
    cities.forEach(function (_, r) { harm += 1 / (r + 1); });
    cities.forEach(function (city, r) {
      city.name = lang.word(rng, 2, 3);
      city.pop = total * tech.urban / (r + 1) / harm;
      city.biome = pl.biome[city.j * W + city.i];
      if (level >= 3) {
        var rad = 9 - r * 0.6;
        for (var n = 0; n < 220 - r * 18; n++) {
          var a = rng() * 6.283, dist = rad * Math.pow(rng(), 1.6);
          var y = Math.round(city.j + Math.sin(a) * dist), x = Math.round(city.i + Math.cos(a) * dist / Math.max(0.25, pl.F.cosLat[city.j]));
          if (y < 0 || y >= H) continue;
          var cell = y * W + ((x % W) + W) % W;
          if (pl.biome[cell] > 2) pl.lights[cell] = Math.max(pl.lights[cell], 255 * (1 - dist / rad * 0.7));
        }
      }
    });

    // Culture déduite du milieu
    var T = home.T, facts = [];
    var habitat = aquatic ? 'cités bâties dans les récifs, à faible profondeur'
      : T < 0 ? 'habitations à demi enterrées, reliées par des galeries chauffées'
      : T > 28 && home.M < 0.35 ? 'villes troglodytes, où l\'on vit surtout la nuit'
      : T > 24 ? 'villages sur pilotis, ouverts aux courants d\'air'
      : home.id === B.FOREST || home.id === B.TAIGA ? 'maisons de bois aux toits pentus'
      : 'maisons de terre et de pierre autour de places de marché';
    if (!aquatic) habitat += g >= 1.35 ? ' ; architecture basse et massive sous ' + fr(g) + ' g' : g <= 0.8 ? ' ; tours effilées et ponts suspendus, permis par la faible gravité' : '';
    facts.push(['Habitat', habitat]);
    facts.push(['Subsistance', aquatic ? 'culture d\'algues et élevage de bancs de poissons'
      : level === 0 ? 'chasse, pêche et cueillette au fil des saisons'
      : home.id === B.GRASS || home.id === B.COLD_STEPPE || home.id === B.SAVANNA || home.id === B.ARID ? 'grands troupeaux menés de pâturage en pâturage'
      : home.id === B.JUNGLE || home.id === B.FOREST ? 'cultures en clairières et vergers étagés'
      : cities.length && pl.liquid > 0.5 ? 'pêche côtière et cultures en terrasses' : 'cultures irriguées le long des cours d\'eau']);
    var localDays = pl.yearDays * 24 / prm.dayH;
    facts.push(['Calendrier', 'année de ' + fr(localDays, 0) + ' jours locaux' +
      (prm.tilt <= 6 ? (prm.moons ? ' ; pas de saisons, on compte en lunaisons' : ' ; ni saisons ni lune : on compte les jours un à un') :
        prm.tilt >= 28 ? ' ; saisons extrêmes, une partie du peuple change de région deux fois par an' : ' ; quatre saisons rythment semailles et récoltes')]);
    facts.push(['Ciel', (prm.star === 'M' ? 'un soleil rouge énorme, presque immobile dans le ciel' : prm.star === 'K' ? 'un soleil orangé à la lumière douce' : prm.star === 'F' ? 'un petit soleil blanc, aveuglant' : 'un soleil jaune') +
      (prm.moons === 0 ? ', des nuits sans lune' : prm.moons === 1 ? ' et une lune' : ' et ' + prm.moons + ' lunes')]);
    if (aquatic) facts.push(['Limite', 'sans feu sous l\'eau, pas de métallurgie : outils de corail, d\'os et de verre volcanique']);

    return { name: name, aquatic: aquatic, tech: tech, level: level, total: total, body: body, home: home, cities: cities, facts: facts, lang: lang };
  }

  // ---------- Assemblage ----------
  PG.life = function (pl, seed) {
    var lang = PG.langFor(pl, seed);
    var out = { lang: lang, groups: [], people: null, note: '', peopleNote: '' };
    if (!pl.alive) {
      out.note = pl.prm.P < 0.05 ? 'Sans atmosphère, l\'eau liquide ne peut pas exister en surface. Aucune vie détectée.'
        : pl.stats[B.SEA_ICE].frac > 0.1 ? 'Surface entièrement gelée. Une vie microbienne reste possible dans l\'océan, sous la glace, près des sources chaudes.'
        : pl.Tmean > 60 ? 'L\'eau s\'est évaporée ou n\'a jamais pu se condenser. Aucune vie détectée.'
        : 'Pas d\'eau liquide en surface. Aucune vie détectée.';
      out.peopleNote = 'Aucune espèce intelligente sur un monde sans biosphère.';
      return out;
    }
    var hosts = pl.stats.filter(function (s) { return !PG.BIOMES[s.id].dead && s.id !== B.ICE && s.frac >= 0.015 && s.T < 75; })
      .sort(function (a, b) { return b.frac - a.frac; }).slice(0, 5);
    hosts.forEach(function (st) {
      var rng = PG.rng('vie' + seed + st.id);
      out.groups.push({
        stat: st, biome: PG.BIOMES[st.id],
        flora: makeFlora(pl, st, rng, lang),
        fauna: [makeAnimal(pl, st, 'herb', rng, lang), makeAnimal(pl, st, 'pred', rng, lang)]
      });
    });
    out.people = makePeople(pl, seed, lang);
    if (!out.people) out.peopleNote = 'Trop peu de terres clémentes ou de mers peu profondes pour qu\'une espèce bâtisse une civilisation.';
    return out;
  };
})();
