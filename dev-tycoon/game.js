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

  // Habillage : rien de ce qui suit ne touche aux règles
  var REFS = { keyboard: 'KB-104', coffee: 'CAF-2000', cams: 'CAM-360' };
  var CODE_COLORS = ['#0000c0', '#202020', '#008000', '#800000', '#0000c0', '#707070'];
  var COMPANY = ['Ma Boîte (en nom propre)', 'Ma Boîte EURL', 'Ma Boîte SARL', 'Ma Boîte SA', 'Ma Boîte Worldwide Group'];
  var MEMOS = [
    null,
    ['Objet : déménagement.', 'La société quitte la chambre pour le garage. Merci de ne pas débrancher le congélateur.'],
    ['Objet : nouveaux locaux.', 'Nous sommes désormais une startup. Un baby-foot a été livré, son usage reste soumis à l\'accord de la Direction.'],
    ['Objet : croissance.', 'La société passe au stade Scale-up. Une fontaine à eau et une plante verte sont installées sur le plateau.'],
    ['Objet : valorisation.', 'La société est officiellement une licorne. Une statue a été commandée. La Direction (toi) se félicite.']
  ];
  var TIPS = [
    'Clique sur ton écran pour coder : chaque clic rapporte. Recrute dès que tu peux, l\'équipe produit sans toi.',
    'Un développeur qui ouvre Klode a l\'écran orange. Clique sur son poste avant la fin du compte à rebours : son salaire baisse un moment.',
    'Pour former quelqu\'un, clique d\'abord sur son poste : sa fiche s\'ouvre à droite avec la prochaine formation.',
    'La machine à café augmente le produit de toute l\'équipe de 25 % par niveau.',
    'Chaque niveau de caméras allonge la baisse de salaire de 10 secondes.',
    'Chaque clavier mécanique double la force de base de ton clic.',
    'Ta partie s\'enregistre toute seule toutes les 5 secondes. Aucune disquette n\'est nécessaire.',
    'L\'onglet Trombinoscope liste toute l\'équipe avec ce que chacun rapporte.'
  ];
  var PROPS = [
    [[1, 4, 2, 8, '#8a5a2b'], [1, 9, 22, 3, '#8a5a2b'], [1, 12, 2, 3, '#5f3d1c'], [21, 12, 2, 3, '#5f3d1c'], [3, 7, 19, 2, '#f4f4f4'], [3, 5, 5, 2, '#dfe3ee'], [9, 6, 13, 3, '#3a6ea5'], [9, 6, 13, 1, '#5b8fc6']],
    [[2, 8, 9, 8, '#c49a5a'], [6, 8, 2, 8, '#e6d2a0'], [4, 2, 8, 6, '#b08040'], [4, 4, 8, 1, '#e6d2a0'], [14, 7, 8, 8, '#1c1c1c'], [13, 9, 10, 4, '#1c1c1c'], [15, 6, 6, 10, '#1c1c1c'], [16, 9, 4, 4, '#8a8a8a'], [17, 10, 2, 2, '#1c1c1c']],
    [[5, 2, 1, 9, '#a0a0a0'], [9, 2, 1, 9, '#a0a0a0'], [14, 2, 1, 9, '#a0a0a0'], [18, 2, 1, 9, '#a0a0a0'], [1, 5, 22, 1, '#8a5a2b'], [2, 6, 20, 5, '#2e8b3a'], [1, 11, 22, 1, '#8a5a2b'], [3, 12, 2, 4, '#5f3d1c'], [19, 12, 2, 4, '#5f3d1c'],
      [4, 7, 3, 2, '#d02020'], [8, 8, 3, 2, '#2040d0'], [13, 7, 3, 2, '#d02020'], [17, 8, 3, 2, '#2040d0'], [5, 1, 1, 1, '#000'], [9, 1, 1, 1, '#000'], [14, 1, 1, 1, '#000'], [18, 1, 1, 1, '#000']],
    [[3, 7, 6, 9, '#8a8a8a'], [4, 8, 4, 8, '#ececec'], [4, 1, 4, 6, '#3a8fd0'], [5, 2, 1, 4, '#9fd0f4'], [5, 10, 2, 1, '#c00000'], [15, 11, 6, 5, '#b5562b'], [14, 11, 8, 1, '#8a3d1c'], [14, 5, 8, 6, '#2e8b3a'], [16, 3, 4, 2, '#2e8b3a'], [17, 6, 1, 5, '#1d6327']],
    [[4, 13, 16, 3, '#6e6e6e'], [5, 14, 14, 1, '#9a9a9a'], [7, 7, 8, 4, '#e0b030'], [7, 11, 1, 2, '#b88a18'], [9, 11, 1, 2, '#e0b030'], [12, 11, 1, 2, '#b88a18'], [14, 11, 1, 2, '#e0b030'], [13, 4, 2, 4, '#e0b030'], [14, 3, 4, 3, '#e0b030'],
      [17, 0, 1, 3, '#fff3a0'], [12, 4, 1, 4, '#e85d8a'], [6, 7, 1, 4, '#e85d8a'], [16, 4, 1, 1, '#000']]
  ];
  var GOAL_BLOCKS = 30;

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
  var matricule = function (i) { return ('000' + (i + 1)).slice(-4); };

  // ---------- Rendu ----------
  var office = $('#office'), roster = $('#roster');
  var view = 'plan', deskRefs = [], rosterRefs = [], meLines = [], meClicks = 0;
  var klodeLogo = '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="currentColor" stroke-width="4">' +
    '<line x1="12" y1="3" x2="12" y2="21"/><line x1="4.2" y1="7.5" x2="19.8" y2="16.5"/><line x1="4.2" y1="16.5" x2="19.8" y2="7.5"/></g></svg>';

  function setText(el, s) {
    if (el._t !== s) { el._t = s; el.textContent = s; }
  }
  function icon(name) {
    return '<svg class="ico" viewBox="0 0 32 32" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }
  function codeLines(seed) {
    var html = '';
    for (var k = 0; k < 6; k++) {
      var w = 30 + ((seed * 37 + k * 53) % 60);
      var indent = ((seed + k) % 3) * 6;
      html += '<i style="--w:' + w + '%;--in:' + indent + 'px;--c:' + CODE_COLORS[(seed + k) % CODE_COLORS.length] + ';--t:' + (2 + ((seed + k) % 4) * 0.4) + 's"></i>';
    }
    return html;
  }
  function lookStyle(look) {
    return '--hair:' + look.hair + ';--skin:' + look.skin + ';--shirt:' + look.shirt;
  }
  function deskHTML(look, seed) {
    return '<span class="tip"></span>' +
      '<span class="warn"><svg viewBox="0 0 32 32" aria-hidden="true"><use href="#i-warn"/></svg></span>' +
      '<span class="stamp">Flagrant délit</span>' +
      '<span class="crt"><span class="screen">' +
        '<span class="ide">' + codeLines(seed) + '</span>' +
        '<span class="klode-scr">' + klodeLogo + '<b>Klode</b></span>' +
      '</span></span>' +
      '<span class="dev" style="' + lookStyle(look) + ';--delay:-' + (seed % 7) * 0.2 + 's"><span class="body"></span><span class="chair"></span><span class="head"></span></span>' +
      '<span class="plate"><b></b><span class="role"></span><span class="net"></span></span>' +
      '<span class="timer"><i></i></span>';
  }
  function photoHTML(look, i) {
    return '<span class="photo h' + (i % 3) + '" style="' + lookStyle(look) + '"><i class="p-body"></i><i class="p-face"></i><i class="p-hair"></i></span>';
  }
  function propSVG(si) {
    var a = PROPS[si], s = '';
    for (var k = 0; k < a.length; k++) s += '<rect x="' + a[k][0] + '" y="' + a[k][1] + '" width="' + a[k][2] + '" height="' + a[k][3] + '" fill="' + a[k][4] + '"/>';
    return '<svg viewBox="0 0 24 16" shape-rendering="crispEdges" aria-hidden="true">' + s + '</svg>';
  }
  function deskRef(el, role, i) {
    return { el: el, role: role, i: i, title: el.querySelector('.role'), net: el.querySelector('.net'), bar: el.querySelector('.timer i'), tip: el.querySelector('.tip'), cost: el.querySelector('.cost') };
  }

  function renderOffice() {
    office.innerHTML = '';
    deskRefs = [];
    var me = document.createElement('button');
    me.type = 'button';
    me.className = 'desk me';
    me.dataset.role = 'me';
    me.innerHTML = deskHTML({ hair: '#2b2118', skin: '#e2b08a', shirt: '#f2f2f2' }, 3);
    me.querySelector('.plate b').textContent = 'Toi';
    me.querySelector('.role').textContent = 'Le patron';
    office.appendChild(me);
    deskRefs.push(deskRef(me, 'me', -1));
    meLines = me.querySelectorAll('.ide i');
    meClicks = 3;
    for (var k = 0; k < meLines.length && k < 3; k++) meLines[k].classList.add('on');

    S.devs.forEach(function (d, i) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'desk';
      el.dataset.role = 'dev';
      el.dataset.i = i;
      el.innerHTML = deskHTML(d, i + 5);
      el.querySelector('.plate b').textContent = d.name;
      office.appendChild(el);
      deskRefs.push(deskRef(el, 'dev', i));
    });

    if (S.devs.length < MAX_DEVS) {
      var slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'desk slot';
      slot.dataset.role = 'hire';
      slot.innerHTML = '<span class="crt off"><span class="screen"></span></span><span class="vacant">Poste vacant</span><b class="go">Recruter</b><span class="cost"></span>';
      office.appendChild(slot);
      deskRefs.push(deskRef(slot, 'hire', -1));
    }

    var prop = document.createElement('div');
    prop.className = 'prop';
    prop.innerHTML = propSVG(stageIndex);
    office.appendChild(prop);
    renderRoster();
  }

  function renderRoster() {
    roster.innerHTML = '';
    rosterRefs = [];
    if (!S.devs.length) {
      roster.innerHTML = '<p class="empty">Aucun salarié pour l\'instant. Recrute ton premier développeur depuis le plan des bureaux.</p>';
      return;
    }
    S.devs.forEach(function (d, i) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'row roster-cols';
      el.dataset.role = 'dev';
      el.dataset.i = i;
      el.innerHTML = '<span>' + matricule(i) + '</span><span class="who">' + photoHTML(d, i) + '<b></b></span><span class="r-title"></span>' +
        '<span class="num x1 r-gross"></span><span class="num x1 r-sal"></span><span class="num r-net"></span><span class="r-state"></span>';
      el.querySelector('b').textContent = d.name;
      roster.appendChild(el);
      rosterRefs.push({ el: el, title: el.querySelector('.r-title'), gross: el.querySelector('.r-gross'), sal: el.querySelector('.r-sal'), net: el.querySelector('.r-net'), state: el.querySelector('.r-state') });
    });
  }

  function renderDevCard() {
    var card = $('#devCard');
    var tbHire = $('#tbHire'), tbTrain = $('#tbTrain');
    if (S.devs.length < MAX_DEVS) tbHire.dataset.cost = hireCost();
    else { delete tbHire.dataset.cost; tbHire.disabled = true; }
    $('#staff').textContent = 'Effectif : ' + S.devs.length + '/' + MAX_DEVS;

    if (!S.devs.length) {
      delete tbTrain.dataset.cost;
      tbTrain.disabled = true;
      card.innerHTML = '<h2 class="legend">Fiche salarié</h2>' +
        '<p class="empty">Aucun salarié. Tu codes seul pour l\'instant : recrute ton premier développeur pour ouvrir sa fiche et lui payer des formations.</p>';
      return;
    }
    if (selected < 0 || selected >= S.devs.length) selected = 0;
    var d = S.devs[selected];
    var maxed = d.lvl >= TRAININGS.length;
    var checks = '';
    for (var k = 0; k < TRAININGS.length; k++) {
      checks += '<li class="' + (k < d.lvl ? 'on' : k === d.lvl ? 'next' : '') + '"><i class="box"></i><span></span></li>';
    }
    card.innerHTML =
      '<h2 class="legend">Fiche salarié</h2>' +
      '<div class="ident">' + photoHTML(d, selected) +
        '<dl class="fields"><dt>Nom :</dt><dd class="field" id="fName"></dd><dt>Poste :</dt><dd class="field" id="fTitle"></dd><dt>Matricule :</dt><dd class="field">' + matricule(selected) + '</dd></dl></div>' +
      '<dl class="pay"><div><dt>Produit</dt><dd class="field" id="pGross"></dd></div><div id="pSalBox"><dt>Salaire</dt><dd class="field" id="pSal"></dd></div><div class="net"><dt>Net pour toi</dt><dd class="field" id="pNet"></dd></div></dl>' +
      '<p class="caption">Formations suivies (chacune : produit ×1,7)</p>' +
      '<ul class="checks">' + checks + '</ul>' +
      (maxed
        ? '<button type="button" class="btn buy" disabled><span class="what">Formations terminées</span><span class="cost">Complet</span></button>'
        : '<button type="button" class="btn buy" data-buy="train"><span class="what"></span><span class="cost"></span></button>');
    card.querySelector('#fName').textContent = d.name;
    card.querySelector('#fTitle').textContent = TITLES[d.lvl];
    var labels = card.querySelectorAll('.checks span');
    for (var c = 0; c < labels.length; c++) labels[c].textContent = TRAININGS[c];
    if (maxed) {
      delete tbTrain.dataset.cost;
      tbTrain.disabled = true;
    } else {
      var b = card.querySelector('.buy');
      b.dataset.cost = trainCost(selected);
      b.querySelector('.what').textContent = 'Inscrire à « ' + TRAININGS[d.lvl] + ' »';
      b.querySelector('.cost').textContent = eur(trainCost(selected));
      tbTrain.dataset.cost = trainCost(selected);
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
      b.className = 'row order-cols' + (maxed ? ' done' : '');
      b.innerHTML = '<span class="ref"></span><span class="what"><b></b><small></small></span><span class="num"></span><span class="go cost"></span>';
      b.querySelector('.ref').textContent = REFS[item.key];
      b.querySelector('b').textContent = item.name;
      b.querySelector('small').textContent = item.desc;
      b.querySelector('.num').textContent = lvl + '/' + item.max;
      if (maxed) {
        b.disabled = true;
        b.querySelector('.cost').textContent = 'Complet';
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

  function applyStage() {
    var t = 'Dev Tycoon 2003 - Gestion du personnel - [' + COMPANY[stageIndex] + ']';
    document.body.dataset.stage = stageIndex;
    document.title = t;
    $('#winTitle').textContent = t;
    $('#stage').textContent = 'Stade : ' + STAGES[stageIndex].name;
    var prop = office.querySelector('.prop');
    if (prop) prop.innerHTML = propSVG(stageIndex);
  }

  function setView(v) {
    view = v;
    $('#plan').hidden = v !== 'plan';
    $('#list').hidden = v !== 'list';
    $('#tabPlan').setAttribute('aria-selected', v === 'plan');
    $('#tabList').setAttribute('aria-selected', v === 'list');
  }

  function setStatus(text) { $('#statusMsg').textContent = text; }

  // Bulle de la zone de notification
  function notify(title, text, kind) {
    var t = document.createElement('div');
    t.className = 'balloon';
    t.innerHTML = icon(kind || 'info') + '<b></b><p></p>';
    t.querySelector('b').textContent = title;
    t.querySelector('p').textContent = text;
    var box = $('#balloons');
    while (box.children.length >= 3) box.firstChild.remove();
    box.appendChild(t);
    t.addEventListener('animationend', function () { t.remove(); });
    setStatus(title + ' : ' + text);
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
  function meFeedback() {
    if (!meLines.length) return;
    var k = meClicks % meLines.length;
    if (k === 0) for (var j = 0; j < meLines.length; j++) meLines[j].classList.remove('on');
    meLines[k].classList.add('on');
    meClicks++;
  }
  function flashSave() {
    var d = $('#trayDisk');
    d.classList.remove('on');
    void d.getBoundingClientRect();
    d.classList.add('on');
  }

  // ---------- Boîtes de dialogue ----------
  var dlgOk = null, dlgModal = false, tipIndex = -1;

  function dialog(o) {
    var text = $('#dlgText'), btns = $('#dlgBtns'), layer = $('#dlgLayer');
    $('#dlgTitle').textContent = o.title;
    $('#dlgIcon').setAttribute('href', '#i-' + o.icon);
    text.innerHTML = '';
    text.classList.toggle('headed', !!o.headed);
    o.text.forEach(function (p) {
      var el = document.createElement('p');
      el.textContent = p;
      text.appendChild(el);
    });
    btns.innerHTML = '';
    o.buttons.forEach(function (b, k) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'btn' + (k === (o.def || 0) ? ' default' : '');
      el.dataset.cmd = b[1];
      el.textContent = b[0];
      btns.appendChild(el);
    });
    dlgOk = o.ok || null;
    dlgModal = !!o.modal;
    layer.classList.toggle('modal', dlgModal);
    layer.hidden = false;
    if (dlgModal && btns.children.length) btns.children[o.def || 0].focus();
  }
  function closeDialog() {
    $('#dlgLayer').hidden = true;
    dlgOk = null;
    dlgModal = false;
  }
  function showTip(k) {
    tipIndex = k % TIPS.length;
    dialog({ title: 'Astuce du jour', icon: 'bulb', headed: true, modal: true, text: ['Le saviez-vous ?', TIPS[tipIndex]], buttons: [['Fermer', 'dlg-cancel'], ['Astuce suivante', 'tip-next']] });
  }
  function showHelp() {
    dialog({
      title: 'Comment jouer', icon: 'info', modal: true, buttons: [['OK', 'dlg-cancel']],
      text: [
        'Clique sur ton écran (le poste « Toi ») pour coder : chaque clic rapporte.',
        'Recrute des développeurs : ils produisent tout seuls. Tu gardes leur produit, moins leur salaire (' + SALARY * 100 + ' %).',
        'Clique sur un poste pour ouvrir la fiche du salarié et lui payer une formation : son produit est multiplié par 1,7.',
        'Surveille les écrans. Un développeur qui ouvre Klode a l\'écran orange pendant ' + AI_WINDOW / 1000 + ' secondes : clique sur son poste pour le prendre sur le fait. Son salaire baisse alors de ' +
          Math.round(SALARY_CUT * 100) + ' % pendant ' + boostDuration() / 1000 + ' secondes.',
        'La société change de stade selon le total gagné : ' + STAGES.map(function (s) { return s.name; }).join(', ') + '.'
      ]
    });
  }

  // ---------- Menus ----------
  var menuPop = null, menuBtn = null;

  function menuItems(name) {
    if (name === 'file') return [
      { label: 'Enregistrer la partie', cmd: 'save' },
      { label: 'Nouvelle partie…', cmd: 'reset' }
    ];
    if (name === 'staff') {
      var d = S.devs[selected];
      var canTrain = d && d.lvl < TRAININGS.length;
      return [
        { label: 'Recruter un développeur', hint: S.devs.length < MAX_DEVS ? eur(hireCost()) : 'Complet', cmd: 'hire', cost: hireCost(), off: S.devs.length >= MAX_DEVS },
        canTrain
          ? { label: 'Former ' + d.name + ' : ' + TRAININGS[d.lvl], hint: eur(trainCost(selected)), buy: 'train', cost: trainCost(selected) }
          : { label: d ? d.name + ' : formations terminées' : 'Former un développeur', off: true },
        null,
        { label: 'Plan des bureaux', cmd: 'view-plan', check: view === 'plan' },
        { label: 'Trombinoscope', cmd: 'view-list', check: view === 'list' }
      ];
    }
    if (name === 'shop') return SHOP.map(function (item) {
      var lvl = S[item.key], maxed = lvl >= item.max;
      return { label: item.name + ' (' + item.desc + ')', hint: maxed ? 'Complet' : eur(item.cost(lvl)), buy: item.key, cost: maxed ? 0 : item.cost(lvl), off: maxed };
    });
    if (name === 'help') return [
      { label: 'Comment jouer', cmd: 'help' },
      { label: 'Astuce du jour', cmd: 'tip' },
      null,
      { label: 'À propos de Dev Tycoon…', cmd: 'about' }
    ];
    return [
      { label: 'Astuce du jour', cmd: 'tip' },
      { label: 'À propos de Dev Tycoon…', cmd: 'about' },
      null,
      { label: 'Arrêter…', cmd: 'shutdown' }
    ];
  }
  function closeMenu() {
    if (!menuPop) return;
    menuPop.remove();
    menuBtn.setAttribute('aria-expanded', 'false');
    menuPop = menuBtn = null;
  }
  function openMenu(btn) {
    closeMenu();
    var pop = document.createElement('div');
    pop.className = 'menu-pop';
    pop.setAttribute('role', 'menu');
    menuItems(btn.dataset.menu).forEach(function (it) {
      if (!it) {
        var hr = document.createElement('hr');
        pop.appendChild(hr);
        return;
      }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item' + (it.check ? ' checked' : '');
      b.setAttribute('role', 'menuitem');
      b.innerHTML = '<span class="lbl"></span><span class="hint"></span>';
      b.querySelector('.lbl').textContent = it.label;
      b.querySelector('.hint').textContent = it.hint || '';
      if (it.off) b.disabled = true;
      else {
        if (it.buy) b.dataset.buy = it.buy;
        if (it.cmd) b.dataset.cmd = it.cmd;
        if (it.cost !== undefined) { b.dataset.cost = it.cost; b.disabled = S.money < it.cost; }
      }
      pop.appendChild(b);
    });
    btn.parentNode.appendChild(pop);
    btn.setAttribute('aria-expanded', 'true');
    menuPop = pop;
    menuBtn = btn;
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
    notify('Nouvelle embauche', d.name + ' rejoint l\'équipe, matricule ' + matricule(selected) + '.');
    renderAll();
    save();
  }

  function buy(key) {
    if (key === 'train') {
      var d = S.devs[selected];
      var cost = trainCost(selected);
      if (!d || d.lvl >= TRAININGS.length || S.money < cost) return;
      S.money -= cost;
      notify('Formation validée', d.name + ' a suivi « ' + TRAININGS[d.lvl] + ' » et passe ' + TITLES[d.lvl + 1] + '.');
      d.lvl++;
    } else {
      var item = SHOP.filter(function (s) { return s.key === key; })[0];
      if (!item || S[key] >= item.max || S.money < item.cost(S[key])) return;
      S.money -= item.cost(S[key]);
      S[key]++;
      notify('Bon de commande validé', item.name + ' (réf. ' + REFS[key] + ') : niveau ' + S[key] + ' sur ' + item.max + '.');
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
    if (desk) desk.querySelector('.tip').textContent = rand(PROMPTS);
  }
  function catchDev(i, now) {
    rt[i].aiUntil = 0;
    rt[i].boostUntil = now + boostDuration();
    S.caught++;
    notify('Rapport d\'incident n° ' + S.caught, S.devs[i].name + ' pris sur Klode ! Salaire −' + Math.round(SALARY_CUT * 100) + ' % pendant ' + boostDuration() / 1000 + ' s.', 'warn');
    save();
  }

  function run(cmd) {
    if (cmd === 'save') {
      save();
      flashSave();
      setStatus('Partie enregistrée.');
    } else if (cmd === 'reset') {
      dialog({
        title: 'Nouvelle partie', icon: 'warn', modal: true, def: 1,
        text: ['Effacer la partie et recommencer de zéro ?', 'L\'équipe, la trésorerie et le matériel seront perdus.'],
        buttons: [['OK', 'dlg-ok'], ['Annuler', 'dlg-cancel']],
        ok: function () {
          S = fresh();
          start();
          save();
        }
      });
    } else if (cmd === 'hire') hire();
    else if (cmd === 'view-plan') setView('plan');
    else if (cmd === 'view-list') setView('list');
    else if (cmd === 'help') showHelp();
    else if (cmd === 'tip') showTip(tipIndex < 0 ? new Date().getDate() : tipIndex);
    else if (cmd === 'tip-next') showTip(tipIndex + 1);
    else if (cmd === 'about') {
      dialog({
        title: 'À propos de Dev Tycoon', icon: 'info', modal: true, buttons: [['OK', 'dlg-cancel']],
        text: ['Dev Tycoon 2003, Gestion du personnel.', 'Version 1.0 (build 2600), édition Patron.', 'Ce logiciel est enregistré au nom de : Toi, ' + COMPANY[stageIndex] + '.', 'Mémoire disponible : 64 Mo. Compatible an 2000.']
      });
    } else if (cmd === 'shutdown') {
      save();
      dialog({
        title: 'Arrêt de l\'ordinateur', icon: 'warn', modal: true, buttons: [['OK', 'dlg-cancel']],
        text: ['Impossible d\'arrêter l\'ordinateur : un patron ne s\'arrête jamais.', 'Ta partie est enregistrée, tu peux fermer l\'onglet sans rien perdre.']
      });
    } else if (cmd === 'dlg-ok') {
      var f = dlgOk;
      closeDialog();
      if (f) f();
    } else if (cmd === 'dlg-cancel') closeDialog();
  }

  function deskDown(e) {
    var desk = e.target.closest('[data-role]');
    if (!desk) return;
    var now = performance.now();
    var role = desk.dataset.role;
    if (role === 'me') {
      var gain = clickPower(now);
      earn(gain);
      var r = office.getBoundingClientRect();
      floatText('+' + eur(gain), e.clientX - r.left - 12, e.clientY - r.top - 22);
      meFeedback();
    } else if (role === 'dev') {
      var i = +desk.dataset.i;
      if (rt[i].aiUntil > now) catchDev(i, now);
      if (selected !== i) { selected = i; renderDevCard(); }
    }
  }
  // Clavier : Entrée / Espace sur un bureau
  function deskClick(e) {
    var desk = e.target.closest('[data-role]');
    if (!desk) return;
    if (desk.dataset.role === 'hire') { hire(); return; }
    if (e.detail !== 0) return; // les clics souris sont déjà traités au pointerdown
    var now = performance.now();
    if (desk.dataset.role === 'me') { earn(clickPower(now)); meFeedback(); }
    else if (desk.dataset.role === 'dev') {
      var i = +desk.dataset.i;
      if (rt[i].aiUntil > now) catchDev(i, now);
      selected = i; renderDevCard();
    }
  }
  office.addEventListener('pointerdown', deskDown);
  office.addEventListener('click', deskClick);
  roster.addEventListener('pointerdown', deskDown);
  roster.addEventListener('click', deskClick);

  document.addEventListener('click', function (e) {
    var m = e.target.closest('[data-menu]');
    if (m) {
      if (menuBtn === m) closeMenu(); else openMenu(m);
      return;
    }
    var b = e.target.closest('[data-buy]');
    if (b && !b.disabled) buy(b.dataset.buy);
    var c = e.target.closest('[data-cmd]');
    closeMenu();
    if (c && !c.disabled) run(c.dataset.cmd);
  });
  document.addEventListener('pointerover', function (e) {
    if (!menuPop) return;
    var m = e.target.closest('.menubar [data-menu]');
    if (m && m !== menuBtn && menuBtn.closest('.menubar')) openMenu(m);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (menuPop) { var b = menuBtn; closeMenu(); b.focus(); }
      else if (!$('#dlgLayer').hidden) closeDialog();
    } else if (menuPop && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      var items = menuPop.querySelectorAll('.menu-item:not(:disabled)');
      if (!items.length) return;
      var k = Array.prototype.indexOf.call(items, document.activeElement);
      k = e.key === 'ArrowDown' ? (k + 1) % items.length : (k <= 0 ? items.length : k) - 1;
      items[k].focus();
      e.preventDefault();
    }
  });

  // ---------- Boucle ----------
  var elMoney = $('#money'), elRate = $('#rate'), elClick = $('#click'), elCaught = $('#caught');
  var elGoalBar = $('#goalBar'), elGoalText = $('#goalText'), elGoalPct = $('#goalPct');
  var elWatch = $('#watch'), elTrayCam = $('#trayCam'), elClock = $('#clock');
  var last = 0, lastSave = 0, lastClock = -1e9, goalBlocks = [], goalOn = -1;

  for (var gb = 0; gb < GOAL_BLOCKS; gb++) goalBlocks.push(elGoalBar.appendChild(document.createElement('i')));

  function setGoal(p) {
    var n = Math.floor(p * GOAL_BLOCKS);
    if (n !== goalOn) {
      for (var k = 0; k < GOAL_BLOCKS; k++) goalBlocks[k].classList.toggle('on', k < n);
      goalOn = n;
    }
    setText(elGoalPct, Math.floor(p * 100) + ' %');
  }

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

    // Comptabilité et barre d'état
    setText(elMoney, eur(S.money));
    setText(elRate, eur(rate) + '/s');
    setText(elClick, '+' + eur(clickPower(now)));
    setText(elCaught, String(S.caught));
    var si = 0;
    while (si < STAGES.length - 1 && S.total >= STAGES[si + 1].at) si++;
    if (si !== stageIndex) {
      var up = si > stageIndex;
      stageIndex = si;
      applyStage();
      if (up) {
        if (dlgModal) notify('Note de service', 'La société passe au stade ' + STAGES[si].name + '.');
        else dialog({ title: 'Note de service n° ' + si, icon: 'info', headed: true, text: MEMOS[si].concat(['La Direction']), buttons: [['OK', 'dlg-cancel']] });
        setStatus('La société passe au stade ' + STAGES[si].name + '.');
      }
    }
    if (si < STAGES.length - 1) {
      var a = STAGES[si].at, b = STAGES[si + 1].at;
      setGoal(Math.min(1, (S.total - a) / (b - a)));
      setText(elGoalText, 'Prochain stade : ' + STAGES[si + 1].name + ' à ' + eur(b) + ' gagnés (' + eur(S.total) + ')');
    } else {
      setGoal(1);
      setText(elGoalText, 'Tu diriges une licorne. ' + eur(S.total) + ' gagnés au total.');
    }

    // Bureaux
    var suspects = 0;
    for (var k = 0; k < deskRefs.length; k++) {
      var d = deskRefs[k];
      if (d.role === 'me') {
        setText(d.net, '+' + eur(clickPower(now)) + ' par clic');
      } else if (d.role === 'dev') {
        var j = d.i, r = rt[j];
        var onAi = r.aiUntil > now, boosted = r.boostUntil > now;
        if (onAi) suspects++;
        d.el.classList.toggle('ai', onAi);
        d.el.classList.toggle('boosted', boosted);
        d.el.classList.toggle('selected', j === selected);
        setText(d.title, TITLES[S.devs[j].lvl]);
        setText(d.net, eur(net(j, now)) + '/s');
        if (onAi) d.bar.style.width = (r.aiUntil - now) / AI_WINDOW * 100 + '%';
        else if (boosted) d.bar.style.width = (r.boostUntil - now) / boostDuration() * 100 + '%';
      } else if (d.role === 'hire') {
        d.el.disabled = S.money < hireCost();
        setText(d.cost, eur(hireCost()));
      }
    }
    elWatch.classList.toggle('alert', suspects > 0);
    elTrayCam.classList.toggle('alert', suspects > 0);
    setText(elWatch, 'Surveillance : ' + (suspects ? suspects + (suspects > 1 ? ' postes suspects' : ' poste suspect') : 'RAS'));

    // Trombinoscope
    if (view === 'list') {
      for (var q = 0; q < rosterRefs.length; q++) {
        var row = rosterRefs[q], rr = rt[q];
        var ai = rr.aiUntil > now, cut = rr.boostUntil > now;
        row.el.classList.toggle('ai', ai);
        row.el.classList.toggle('boosted', cut);
        row.el.classList.toggle('selected', q === selected);
        setText(row.title, TITLES[S.devs[q].lvl]);
        setText(row.gross, eur(gross(q)) + '/s');
        setText(row.sal, '−' + eur(salary(q, now)) + '/s');
        setText(row.net, eur(net(q, now)) + '/s');
        setText(row.state, ai ? 'Sur Klode !' : cut ? 'Salaire réduit, ' + Math.ceil((rr.boostUntil - now) / 1000) + ' s' : 'Au travail');
      }
    }

    // Commandes payantes et fiche
    var buys = document.querySelectorAll('[data-cost]');
    for (var m = 0; m < buys.length; m++) buys[m].disabled = S.money < +buys[m].dataset.cost;
    if (S.devs.length && $('#pGross')) {
      setText($('#pGross'), eur(gross(selected)) + '/s');
      setText($('#pSal'), '−' + eur(salary(selected, now)) + '/s');
      setText($('#pNet'), eur(net(selected, now)) + '/s');
      $('#pSalBox').classList.toggle('cut', isBoosted(selected, now));
    }

    if (now - lastClock > 1000) {
      lastClock = now;
      var date = new Date();
      setText(elClock, ('0' + date.getHours()).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2));
    }
    if (now - lastSave > 5000) { lastSave = now; save(); flashSave(); }
    requestAnimationFrame(frame);
  }

  function start() {
    rt = S.devs.map(function () { return { aiUntil: 0, boostUntil: 0 }; });
    selected = S.devs.length ? 0 : -1;
    stageIndex = 0;
    while (stageIndex < STAGES.length - 1 && S.total >= STAGES[stageIndex + 1].at) stageIndex++;
    scheduleAi(performance.now(), 10000);
    renderAll();
    applyStage();
    setStatus('Prêt');
    if (!S.total && !S.devs.length) showTip(0);
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
