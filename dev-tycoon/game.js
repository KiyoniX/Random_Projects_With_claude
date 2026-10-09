(function () {
  'use strict';

  var SAVE_KEY = 'dev-tycoon-v1';
  var MAX_DEVS = 11;
  var SALARY = 0.4;        // part du produit versée en salaire
  var SALARY_CUT = 0.6;    // baisse de salaire quand un dev est pris sur Klode
  var AI_WINDOW = 9000;    // temps pour le surprendre (ms)
  var BOOST_BASE = 30000;  // durée de la baisse de salaire (ms)

  var NAMES = ['Léa', 'Hugo', 'Inès', 'Malo', 'Chloé', 'Yanis', 'Jade', 'Noé', 'Lina', 'Tom', 'Zoé', 'Sacha', 'Maël', 'Nina', 'Enzo', 'Louise'];
  var HAIRS = ['#2b2118', '#5a3a22', '#c98a3c', '#e8d28a', '#8b2f2f', '#1f2a44', '#6c4bb5', '#d9d9de'];
  var SKINS = ['#f3d2b4', '#e2b08a', '#c68a5e', '#8d5a3b', '#f7dfc9'];
  var SHIRTS = ['#4f7cff', '#ff7a59', '#3fbf8f', '#b06cff', '#f2c14e', '#e85d8a', '#45b5c4'];
  var TITLES = ['Stagiaire', 'Junior', 'Confirmé', 'Senior', 'Lead', 'Staff', 'Principal'];
  var TRAININGS = ['Git sans pleurer', 'Tests unitaires', 'TypeScript', 'Docker & CI', 'Architecture', 'Parler aux clients'];
  var PROMPTS = ['écris toute la fonction stp', 'corrige mon bug vite', 'fais ma PR à ma place', 'c\'est quoi une regex', 'explique mon propre code'];
  var CODE_COLORS = ['#7aa2ff', '#c792ea', '#7ee08a', '#ffb454', '#ff7a90', '#5fd3e0'];
  var STAGES = [
    { at: 0, name: 'Chambre' },
    { at: 200, name: 'Garage' },
    { at: 5000, name: 'Startup' },
    { at: 100000, name: 'Scale-up' },
    { at: 2000000, name: 'Licorne' }
  ];

  var SHOP = [
    { key: 'keyboard', name: 'Clavier mécanique', desc: 'Clic ×2', max: 8, cost: function (l) { return 25 * Math.pow(3, l); } },
    { key: 'coffee', name: 'Machine à café', desc: 'Équipe +25 % de produit', max: 6, cost: function (l) { return 200 * Math.pow(4, l); } },
    { key: 'cams', name: 'Caméras', desc: 'Baisse de salaire +10 s', max: 3, cost: function (l) { return 600 * Math.pow(5, l); } }
  ];

  var $ = function (s) { return document.querySelector(s); };
  var rand = function (a) { return a[Math.floor(Math.random() * a.length)]; };

  // ---------- État ----------
  var S, rt, selected = -1, nextAiAt = 0, stageIndex = 0;

  function fresh() {
    return { money: 0, total: 0, caught: 0, keyboard: 0, coffee: 0, cams: 0, devs: [] };
  }
  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (raw && Array.isArray(raw.devs)) {
        S = Object.assign(fresh(), raw);
        return;
      }
    } catch (e) { /* sauvegarde illisible : nouvelle partie */ }
    S = fresh();
  }
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* stockage indisponible */ }
  }

  // ---------- Économie ----------
  function gross(i) {
    return 2 * Math.pow(1.35, i) * Math.pow(1.7, S.devs[i].lvl) * (1 + 0.25 * S.coffee);
  }
  function isBoosted(i, now) { return rt[i].boostUntil > now; }
  function salary(i, now) {
    return gross(i) * SALARY * (isBoosted(i, now) ? 1 - SALARY_CUT : 1);
  }
  function net(i, now) { return gross(i) - salary(i, now); }
  function teamRate(now) {
    var r = 0;
    for (var i = 0; i < S.devs.length; i++) r += net(i, now);
    return r;
  }
  function clickPower(now) {
    return Math.pow(2, S.keyboard) + teamRate(now) * 0.05;
  }
  function hireCost() { return 30 * Math.pow(1.8, S.devs.length); }
  function trainCost(i) { return 60 * Math.pow(1.5, i) * Math.pow(2.4, S.devs[i].lvl); }
  function boostDuration() { return BOOST_BASE + S.cams * 10000; }
  function earn(v) { S.money += v; S.total += v; }

  function fmt(n) {
    var units = [[1e12, ' Bn'], [1e9, ' Md'], [1e6, ' M'], [1e3, ' k']];
    for (var u = 0; u < units.length; u++) {
      if (n >= units[u][0]) {
        var v = n / units[u][0];
        return v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2).replace('.', ',') + units[u][1];
      }
    }
    return (n >= 100 ? Math.floor(n) : Math.floor(n * 10) / 10).toString().replace('.', ',');
  }
  var eur = function (n) { return fmt(n) + ' €'; };

  // ---------- Rendu ----------
  var office = $('#office');
  var klodeLogo = '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="currentColor" stroke-width="4" stroke-linecap="round">' +
    '<line x1="12" y1="3" x2="12" y2="21"/><line x1="4.2" y1="7.5" x2="19.8" y2="16.5"/><line x1="4.2" y1="16.5" x2="19.8" y2="7.5"/></g></svg>';

  function codeLines(seed) {
    var html = '';
    for (var k = 0; k < 6; k++) {
      var w = 30 + ((seed * 37 + k * 53) % 60);
      var indent = ((seed + k) % 3) * 8;
      html += '<i style="--w:' + w + '%;--in:' + indent + 'px;--c:' + CODE_COLORS[(seed + k) % CODE_COLORS.length] + ';--t:' + (2 + ((seed + k) % 4) * 0.4) + 's"></i>';
    }
    return html;
  }
  function deskHTML(look, seed) {
    return '<span class="bubble">Klode !</span>' +
      '<span class="monitor"><span class="screen">' +
        '<span class="screen-code">' + codeLines(seed) + '</span>' +
        '<span class="screen-ai"><span class="klode">' + klodeLogo + 'Klode</span>' +
          '<span class="chat q"></span><span class="chat a"><i></i><i></i></span></span>' +
      '</span></span>' +
      '<span class="dev" style="--hair:' + look.hair + ';--skin:' + look.skin + ';--shirt:' + look.shirt + ';--delay:-' + (seed % 7) * 0.2 + 's"><span class="head"></span><span class="body"></span></span>' +
      '<span class="plate"><b></b><span></span></span>' +
      '<span class="timer"><i></i></span>';
  }

  function renderOffice() {
    office.innerHTML = '';
    var me = document.createElement('button');
    me.type = 'button';
    me.className = 'desk me';
    me.dataset.role = 'me';
    me.innerHTML = deskHTML({ hair: '#2b2118', skin: '#e2b08a', shirt: '#ffb454' }, 3);
    me.querySelector('.plate b').textContent = 'Toi';
    office.appendChild(me);

    S.devs.forEach(function (d, i) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'desk';
      el.dataset.role = 'dev';
      el.dataset.i = i;
      el.innerHTML = deskHTML(d, i + 5);
      el.querySelector('.plate b').textContent = d.name;
      office.appendChild(el);
    });

    if (S.devs.length < MAX_DEVS) {
      var slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'desk slot';
      slot.dataset.role = 'hire';
      slot.innerHTML = '<span class="slot-plus">+</span><b>Recruter un dev</b><span class="cost"></span>';
      office.appendChild(slot);
    }
  }

  function renderDevCard() {
    var card = $('#devCard');
    if (!S.devs.length) {
      card.innerHTML = '<h2>Ton équipe</h2><p class="sub">Tu codes seul pour l\'instant. Recrute ton premier dev pour débloquer les formations.</p>';
      return;
    }
    if (selected < 0 || selected >= S.devs.length) selected = 0;
    var d = S.devs[selected];
    var steps = '';
    for (var k = 0; k < TRAININGS.length; k++) steps += '<i class="' + (k < d.lvl ? 'on' : '') + '"></i>';
    var maxed = d.lvl >= TRAININGS.length;
    card.innerHTML =
      '<h2></h2><p class="sub"></p>' +
      '<dl class="pay"><div><dt>Produit</dt><dd id="pGross"></dd></div><div id="pSalBox"><dt>Salaire</dt><dd id="pSal"></dd></div><div class="net"><dt>Net</dt><dd id="pNet"></dd></div></dl>' +
      '<div class="steps">' + steps + '</div>' +
      (maxed
        ? '<button type="button" class="buy done" disabled><span><b>Formations terminées</b><small>Ce dev n\'a plus rien à apprendre</small></span><span class="cost">Max</span></button>'
        : '<button type="button" class="buy" data-buy="train"><span><b></b><small>Formation · produit ×1,7</small></span><span class="cost"></span></button>');
    card.querySelector('h2').textContent = d.name;
    card.querySelector('.sub').textContent = TITLES[d.lvl] + ' · clique sur un autre bureau pour changer de dev';
    if (!maxed) {
      var b = card.querySelector('.buy');
      b.dataset.cost = trainCost(selected);
      b.querySelector('b').textContent = TRAININGS[d.lvl];
      b.querySelector('.cost').textContent = eur(trainCost(selected));
    }
  }

  function renderShop() {
    var ul = $('#shop');
    ul.innerHTML = '';
    SHOP.forEach(function (item) {
      var lvl = S[item.key];
      var maxed = lvl >= item.max;
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'buy' + (maxed ? ' done' : '');
      b.innerHTML = '<span><b></b><small></small></span><span class="cost"></span>';
      b.querySelector('b').textContent = item.name + (lvl ? ' · niv. ' + lvl : '');
      b.querySelector('small').textContent = item.desc;
      if (maxed) {
        b.disabled = true;
        b.querySelector('.cost').textContent = 'Max';
      } else {
        b.dataset.buy = item.key;
        b.dataset.cost = item.cost(lvl);
        b.querySelector('.cost').textContent = eur(item.cost(lvl));
      }
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  function renderAll() { renderOffice(); renderDevCard(); renderShop(); }

  function toast(text, kind) {
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = text;
    var box = $('#toasts');
    while (box.children.length >= 3) box.firstChild.remove();
    box.appendChild(t);
    t.addEventListener('animationend', function () { t.remove(); });
  }
  function floatText(text, x, y) {
    var f = document.createElement('span');
    f.className = 'float';
    f.textContent = text;
    f.style.left = x + 'px';
    f.style.top = y + 'px';
    office.appendChild(f);
    f.addEventListener('animationend', function () { f.remove(); });
  }

  // ---------- Actions ----------
  function hire() {
    var cost = hireCost();
    if (S.money < cost || S.devs.length >= MAX_DEVS) return;
    S.money -= cost;
    var used = S.devs.map(function (d) { return d.name; });
    var free = NAMES.filter(function (n) { return used.indexOf(n) < 0; });
    var d = { name: rand(free), hair: rand(HAIRS), skin: rand(SKINS), shirt: rand(SHIRTS), lvl: 0 };
    S.devs.push(d);
    rt.push({ aiUntil: 0, boostUntil: 0 });
    selected = S.devs.length - 1;
    if (S.devs.length === 1) scheduleAi(performance.now(), 12000);
    toast(d.name + ' rejoint l\'équipe.');
    renderAll();
    save();
  }

  function buy(key) {
    if (key === 'train') {
      var d = S.devs[selected];
      var cost = trainCost(selected);
      if (!d || d.lvl >= TRAININGS.length || S.money < cost) return;
      S.money -= cost;
      toast(d.name + ' a suivi « ' + TRAININGS[d.lvl] + ' » et passe ' + TITLES[d.lvl + 1] + '.');
      d.lvl++;
    } else {
      var item = SHOP.filter(function (s) { return s.key === key; })[0];
      if (!item || S[key] >= item.max || S.money < item.cost(S[key])) return;
      S.money -= item.cost(S[key]);
      S[key]++;
    }
    renderDevCard();
    renderShop();
    save();
  }

  function scheduleAi(now, delay) {
    nextAiAt = now + (delay || (7000 + Math.random() * 11000) / Math.sqrt(Math.max(1, S.devs.length) / 2 + 0.5));
  }
  function startAi(i, now) {
    rt[i].aiUntil = now + AI_WINDOW;
    var desk = office.querySelector('.desk[data-i="' + i + '"]');
    if (desk) desk.querySelector('.chat.q').textContent = rand(PROMPTS);
  }
  function catchDev(i, now) {
    rt[i].aiUntil = 0;
    rt[i].boostUntil = now + boostDuration();
    S.caught++;
    toast(S.devs[i].name + ' pris sur Klode ! Salaire −' + Math.round(SALARY_CUT * 100) + ' % pendant ' + boostDuration() / 1000 + ' s.', 'good');
    save();
  }

  office.addEventListener('pointerdown', function (e) {
    var desk = e.target.closest('.desk');
    if (!desk) return;
    var now = performance.now();
    var role = desk.dataset.role;
    if (role === 'me') {
      var gain = clickPower(now);
      earn(gain);
      var r = office.getBoundingClientRect();
      floatText('+' + eur(gain), e.clientX - r.left - 12, e.clientY - r.top - 18);
      desk.classList.remove('hit');
      void desk.offsetWidth;
      desk.classList.add('hit');
    } else if (role === 'dev') {
      var i = +desk.dataset.i;
      if (rt[i].aiUntil > now) catchDev(i, now);
      if (selected !== i) { selected = i; renderDevCard(); }
    }
  });
  // Clavier : Entrée / Espace sur un bureau
  office.addEventListener('click', function (e) {
    var desk = e.target.closest('.desk');
    if (!desk) return;
    if (desk.dataset.role === 'hire') { hire(); return; }
    if (e.detail !== 0) return; // les clics souris sont déjà traités au pointerdown
    var now = performance.now();
    if (desk.dataset.role === 'me') earn(clickPower(now));
    else if (desk.dataset.role === 'dev') {
      var i = +desk.dataset.i;
      if (rt[i].aiUntil > now) catchDev(i, now);
      selected = i; renderDevCard();
    }
  });
  document.querySelector('.panel').addEventListener('click', function (e) {
    var b = e.target.closest('[data-buy]');
    if (b && !b.disabled) buy(b.dataset.buy);
  });
  $('#reset').addEventListener('click', function () {
    if (!window.confirm('Effacer la partie et recommencer de zéro ?')) return;
    S = fresh();
    start();
    save();
  });

  // ---------- Boucle ----------
  var elMoney = $('#money'), elRate = $('#rate'), elStage = $('#stage'), elCaught = $('#caught');
  var elGoalBar = $('#goalBar'), elGoalText = $('#goalText');
  var last = 0, lastSave = 0;

  function frame(now) {
    var dt = Math.min(1, (now - last) / 1000);
    last = now;
    var rate = teamRate(now);
    earn(rate * dt);

    // Un dev ouvre Klode
    if (S.devs.length && now >= nextAiAt) {
      var free = [];
      for (var i = 0; i < S.devs.length; i++) if (rt[i].aiUntil <= now && !isBoosted(i, now)) free.push(i);
      if (free.length) startAi(rand(free), now);
      scheduleAi(now);
    }

    // HUD
    elMoney.textContent = eur(S.money);
    elRate.textContent = eur(rate) + '/s';
    elCaught.textContent = S.caught;
    var si = 0;
    while (si < STAGES.length - 1 && S.total >= STAGES[si + 1].at) si++;
    if (si !== stageIndex) {
      if (si > stageIndex) toast('Nouveau stade : ' + STAGES[si].name + ' !', 'big');
      stageIndex = si;
    }
    elStage.textContent = STAGES[si].name;
    if (si < STAGES.length - 1) {
      var a = STAGES[si].at, b = STAGES[si + 1].at;
      elGoalBar.style.transform = 'scaleX(' + Math.min(1, (S.total - a) / (b - a)) + ')';
      elGoalText.textContent = 'Prochain stade : ' + STAGES[si + 1].name + ' à ' + eur(b) + ' gagnés (' + eur(S.total) + ')';
    } else {
      elGoalBar.style.transform = 'scaleX(1)';
      elGoalText.textContent = 'Tu diriges une licorne. ' + eur(S.total) + ' gagnés au total.';
    }

    // Bureaux
    var desks = office.children;
    for (var k = 0; k < desks.length; k++) {
      var el = desks[k], role = el.dataset.role;
      if (role === 'me') {
        el.querySelector('.plate span').textContent = '+' + eur(clickPower(now)) + ' par clic';
      } else if (role === 'dev') {
        var j = +el.dataset.i, r = rt[j];
        var onAi = r.aiUntil > now, boosted = r.boostUntil > now;
        el.classList.toggle('ai', onAi);
        el.classList.toggle('boosted', boosted);
        el.classList.toggle('selected', j === selected);
        el.querySelector('.plate span').textContent = TITLES[S.devs[j].lvl] + ' · ' + eur(net(j, now)) + '/s';
        var bar = el.querySelector('.timer i');
        if (onAi) bar.style.transform = 'scaleX(' + (r.aiUntil - now) / AI_WINDOW + ')';
        else if (boosted) bar.style.transform = 'scaleX(' + (r.boostUntil - now) / boostDuration() + ')';
      } else if (role === 'hire') {
        el.disabled = S.money < hireCost();
        el.querySelector('.cost').textContent = eur(hireCost());
      }
    }

    // Panneau
    var buys = document.querySelectorAll('.panel [data-buy]');
    for (var m = 0; m < buys.length; m++) buys[m].disabled = S.money < +buys[m].dataset.cost;
    if (S.devs.length && $('#pGross')) {
      var cut = isBoosted(selected, now);
      $('#pGross').textContent = eur(gross(selected)) + '/s';
      $('#pSal').textContent = '−' + eur(salary(selected, now)) + '/s';
      $('#pNet').textContent = eur(net(selected, now)) + '/s';
      $('#pSalBox').classList.toggle('cut', cut);
    }

    if (now - lastSave > 5000) { lastSave = now; save(); }
    requestAnimationFrame(frame);
  }

  function start() {
    rt = S.devs.map(function () { return { aiUntil: 0, boostUntil: 0 }; });
    selected = S.devs.length ? 0 : -1;
    stageIndex = 0;
    while (stageIndex < STAGES.length - 1 && S.total >= STAGES[stageIndex + 1].at) stageIndex++;
    scheduleAi(performance.now(), 10000);
    renderAll();
  }

  load();
  start();
  window.addEventListener('beforeunload', save);
  last = performance.now();
  requestAnimationFrame(frame);

  // Accès pour les tests automatiques
  window.__tycoon = {
    state: function () { return S; },
    give: function (v) { earn(v); },
    forceAi: function (i) { startAi(i, performance.now()); }
  };
})();
