// Bureau des réclamations : sept jours de guichet à tamponner des dossiers absurdes selon un règlement qui change chaque matin.
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var rnd = function (n) { return Math.floor(Math.random() * n); };
  var pick = function (a) { return a[rnd(a.length)]; };
  var euro = function (n) { return (n < 0 ? '−' : '') + Math.abs(n) + '\u00a0€'; };
  // À l'affichage seulement : pas de deux-points ni de guillemet fermant rejeté seul en début de ligne
  var typo = function (s) { return s.replace(/ ([:;?!»])/g, '\u00a0$1'); };

  var DAYS = 7, DAY_LEN = 210, PRIME = 10, AMENDE = 10, SAVE = 'bureau-des-reclamations';
  var WEEK = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  // Le jour 1 est le lundi 16 novembre : tout le jeu tient dans le même mois
  var today = function (day) { return 15 + day; };
  var dateOf = function (day) { return WEEK[day - 1] + ' ' + today(day) + ' novembre'; };

  // ---------- Plaignants et réclamations ----------
  var NOMS = ['Lefèvre', 'Moreau', 'Vautrin', 'Castagnier', 'Pruneau', 'Delacroche', 'Tisserand', 'Mouchel', 'Grandjean', 'Bellavoine',
    'Quintard', 'Roussignol', 'Ferrand', 'Oudin', 'Haquet', 'Lambrequin', 'Poisson', 'Chapelier', 'Dutilleul', 'Brisebois'];
  var PRENOMS = ['Bernard', 'Odile', 'Gisèle', 'Raymond', 'Solange', 'Yvon', 'Huguette', 'Marcel', 'Paulette', 'Firmin',
    'Colette', 'Anselme', 'Ginette', 'Léonce', 'Mireille', 'Octave', 'Josiane', 'Armand'];
  var OBJETS = {
    'Météo': ['Il a plu chez moi sans préavis.', 'Le vent a tourné la page de mon livre avant que j’aie fini.',
      'Le soleil s’est couché plus tôt que la veille, sans compensation.', 'Un nuage stationne au-dessus de mon potager depuis mardi.',
      'L’arc-en-ciel annoncé n’a pas été livré.', 'Le brouillard m’a caché une mauvaise nouvelle.'],
    'Voisinage': ['Mon voisin pense trop fort.', 'L’escalier de mon immeuble compte une marche de plus le soir que le matin.',
      'Ma voisine arrose ses fleurs en plastique sur mon balcon.', 'Le voisin du dessus n’existe pas, mais il marche.',
      'L’écho de ma cour répond à côté.', 'Mon palier est plus loin qu’avant.'],
    'Temps': ['Mon ombre arrive en retard.', 'Le mardi a duré plus longtemps que prévu.',
      'On m’a rendu la monnaie d’une heure en minutes usagées.', 'Ma montre avance sur mes projets.',
      'Dimanche dernier a été annulé sans notification.', 'J’ai perdu un quart d’heure et on ne me l’a pas rapporté.'],
    'Objets': ['Mon parapluie ne s’ouvre qu’à l’intérieur.', 'Ma chaise me regarde quand je suis debout.',
      'Le tiroir de ma commode contient un autre tiroir.', 'Ma porte grince des reproches.',
      'Mon miroir a un temps de retard.', 'Ma bouilloire siffle un air que je n’ai pas choisi.'],
    'Animaux': ['Le chat de la concierge signe à ma place.', 'Un pigeon occupe mon poste depuis lundi.',
      'Mon poisson rouge me tutoie.', 'Les escargots de mon jardin roulent trop vite.',
      'Une mouche a lu mon courrier.', 'Le chien d’en face aboie mon nom de jeune fille.'],
    'Administration': ['Ma précédente réclamation a été approuvée par erreur.',
      'Le formulaire de réclamation ne permet pas de réclamer contre lui-même.', 'Le guichet m’a dit bonjour sur un ton irrecevable.',
      'J’ai reçu un accusé de réception pour un dossier que je n’ai pas encore déposé.',
      'Le ticket numéro 0 a été appelé avant le mien.', 'On m’a remboursé une somme que je n’avais pas demandée.']
  };
  var PIECES = [['attest', 'Attestation sur l’honneur'], ['timbre', 'Timbre fiscal'], ['photo', 'Photo d’identité'],
    ['domicile', 'Justificatif de domicile'], ['temoin', 'Témoignage d’un voisin'], ['consent', 'Consentement de l’objet']];
  var INKS = ['bleue', 'noire', 'verte', 'rouge'];
  var HELLO = ['Bonjour. C’est pour une réclamation.', 'J’attends depuis ce matin.', 'C’est bien ici, les réclamations ?',
    'On m’a dit de revenir avec le bon formulaire. Le voici.', 'Je ne vous dérange pas, au moins ?', 'C’est la troisième fois que je viens.',
    'J’ai tout rempli. Enfin, je crois.', 'Vous allez voir, c’est très simple.'];
  var REPLIES = {
    approve: ['Merci. Je n’y croyais plus.', 'Enfin !', 'Ah. Je n’avais pas prévu que ça marche.'],
    refuse: ['Encore ? Je reviendrai.', 'C’est un scandale. Je vais réclamer.', 'On m’avait pourtant dit que c’était bon.'],
    transmit: ['Et c’est où, ce service ?', 'J’en viens. Ils m’ont renvoyé ici.', 'Très bien. Je connais le chemin.']
  };
  var MARKS = { approve: 'APPROUVÉ', refuse: 'REFUSÉ', transmit: 'TRANSMIS' };

  // ---------- Règlement ----------
  // Chaque article garde son numéro toute la semaine ; `v` liste ses rédactions successives [jour d'entrée en vigueur, texte].
  var inks = function (day) { return day < 4 ? ['bleue', 'noire'] : day < 6 ? ['noire'] : ['verte']; };
  var limit = function (day) { return day < 5 ? 10 : 5; };
  var closed = function (day) { return day < 4 ? ['C'] : day < 6 ? ['A'] : ['A', 'C', 'D']; };
  var cap = function (day) { return day < 5 ? 500 : 200; };
  var transmitCats = function (day) { return day < 3 ? [] : day < 5 ? ['Météo'] : day < 7 ? ['Météo', 'Administration'] : ['Administration']; };
  var outside = function (all, some) { return all.filter(function (x) { return some.indexOf(x) < 0; }); };

  var RULES = [
    { art: 1, nom: 'Signature', from: 1, v: [[1, 'Le dossier est signé de la main du plaignant, et de personne d’autre.']],
      ok: function (d) { return d.sig === 'own'; },
      fix: function (d) { d.sig = 'own'; },
      spoil: function (d) {
        if (Math.random() < 0.5) { d.sig = 'none'; return; }
        d.sig = 'other'; d.sigName = pick(PRENOMS) + ' ' + pick(outside(NOMS, [d.nom]));
      } },
    { art: 2, nom: 'Encre', from: 1, v: [[1, 'Seules les encres bleue et noire sont admises.'],
        [4, 'Le bleu étant jugé trop optimiste, seule l’encre noire est admise.'],
        [6, 'L’encre noire est réservée au deuil national. Seule l’encre verte est admise.']],
      ok: function (d, day) { return inks(day).indexOf(d.encre) >= 0; },
      fix: function (d, day) { d.encre = pick(inks(day)); },
      spoil: function (d, day) { d.encre = pick(outside(INKS, inks(day))); } },
    { art: 3, nom: 'Attestation', from: 1, v: [[1, 'Une attestation sur l’honneur est jointe au dossier.']],
      ok: function (d) { return d.attest; },
      fix: function (d) { d.attest = true; },
      spoil: function (d) { d.attest = false; } },
    { art: 4, nom: 'Prescription', from: 1, v: [[1, 'Le préjudice date de 10 jours au plus, et il a déjà eu lieu.'],
        [5, 'Le préjudice date de 5 jours au plus, et il a déjà eu lieu.']],
      ok: function (d, day) { var age = today(day) - d.jour; return age >= 0 && age <= limit(day); },
      fix: function (d, day) { d.jour = today(day) - rnd(limit(day) + 1); },
      spoil: function (d, day) { d.jour = Math.random() < 0.7 ? today(day) - limit(day) - 1 - rnd(4) : today(day) + 1 + rnd(3); } },
    { art: 5, nom: 'Guichets', from: 2, v: [[2, 'Le guichet C est fermé pour travaux. Rien de ce qui en vient n’est recevable.'],
        [4, 'Le guichet C rouvre. Le guichet A ferme, par souci d’équilibre.'],
        [6, 'Les guichets A et C sont fermés. Le guichet D n’a jamais existé.']],
      ok: function (d, day) { return closed(day).indexOf(d.guichet) < 0; },
      fix: function (d, day) { d.guichet = pick(outside(['A', 'B', 'C', 'D'], closed(day))); },
      spoil: function (d, day) { d.guichet = pick(closed(day)); } },
    { art: 6, nom: 'Plafond', from: 2, v: [[2, 'L’indemnité demandée ne dépasse pas 500 €.'], [5, 'L’indemnité demandée ne dépasse pas 200 €.']],
      ok: function (d, day) { return d.montant <= cap(day); },
      fix: function (d, day) { d.montant = 5 * (1 + rnd(cap(day) / 5)); },
      spoil: function (d, day) { d.montant = cap(day) + 5 * (1 + rnd(40)); } },
    { art: 7, nom: 'Parité', from: 3, v: [[3, 'Les dossiers de numéro pair se traitent les jours pairs du mois, les impairs les jours impairs.']],
      ok: function (d, day) { return d.num % 2 === today(day) % 2; },
      fix: function (d) { d.num += d.num < 9999 ? 1 : -1; },
      spoil: function (d) { d.num += d.num < 9999 ? 1 : -1; } },
    { art: 8, nom: 'Timbre fiscal', from: 3, v: [[3, 'Au-delà de 100 €, un timbre fiscal est joint.'],
        [7, 'Au-delà de 100 €, un timbre fiscal est joint. Jusqu’à 100 €, il constitue une tentative de corruption.']],
      ok: function (d, day) { return d.montant > 100 ? d.timbre : day < 7 || !d.timbre; },
      fix: function (d) { d.timbre = d.montant > 100; },
      spoil: function (d, day) {
        if (day === 7 && Math.random() < 0.5) { if (d.montant > 100) d.montant = 5 * (1 + rnd(20)); d.timbre = true; return; }
        if (d.montant <= 100) d.montant = 105 + 5 * rnd(19);
        d.timbre = false;
      } },
    // L'article 9 ne motive aucun refus : il désigne les catégories à transmettre sans examen
    { art: 9, nom: 'Transmission', from: 3, v: [[3, 'La catégorie Météo relève du Service du Ciel : TRANSMETTRE sans examen.'],
        [5, 'Les catégories Météo et Administration sont à TRANSMETTRE sans examen. Les réclamations contre l’Administration sont transmises au Bureau des réclamations.'],
        [7, 'Le Service du Ciel est dissous : la Météo revient au Bureau. Seule la catégorie Administration est à TRANSMETTRE sans examen.']] },
    { art: 10, nom: 'Photo', from: 4, v: [[4, 'Une photo d’identité est jointe, afin d’établir que le plaignant existe.'],
        [6, 'Les photos d’identité sont interdites, par respect pour la vie privée des photographiés.']],
      ok: function (d, day) { return d.photo === day < 6; },
      fix: function (d, day) { d.photo = day < 6; },
      spoil: function (d, day) { d.photo = day >= 6; } },
    { art: 11, nom: 'Consentement', from: 6, v: [[6, 'Tout objet mis en cause (catégorie Objets) a donné son consentement écrit.']],
      ok: function (d) { return d.cat !== 'Objets' || d.consent; },
      fix: function (d) { d.consent = true; },
      spoil: function (d) { d.cat = 'Objets'; d.objet = pick(OBJETS.Objets); d.consent = false; } },
    { art: 12, nom: 'Bernard', from: 7, v: [[7, 'Les plaignants prénommés Bernard ne sont plus recevables.']],
      ok: function (d) { return d.prenom !== 'Bernard'; },
      fix: function (d) { d.prenom = pick(outside(PRENOMS, ['Bernard'])); },
      spoil: function (d) { d.prenom = 'Bernard'; } }
  ];
  var active = function (day) { return RULES.filter(function (r) { return r.from <= day; }); };
  var textOf = function (r, day) { var t = ''; r.v.forEach(function (v) { if (v[0] <= day) t = v[1]; }); return t; };
  var changed = function (r, day) { return r.v.some(function (v) { return v[0] === day; }); };
  var tagOf = function (r, day) { return day === 1 || !changed(r, day) ? '' : r.from === day ? 'nouveau' : 'modifié'; };

  var MEMO = ['',
    'Bienvenue au guichet 7. Approuvez ce qui est conforme, refusez le reste en citant l’article enfreint. Ne souriez pas : c’est un autre service.',
    'Le guichet C est fermé pour travaux. Les travaux consistent à le fermer. Un plafond d’indemnisation entre par ailleurs en vigueur.',
    'Le Service du Ciel réclame ses dossiers. Un tampon TRANSMIS vous est confié. Il est neuf, ne l’abîmez pas.',
    'Le bleu a été jugé trop optimiste. Le guichet C rouvre ; par souci d’équilibre, le guichet A ferme. Une photo est exigée, pour vérifier que les plaignants existent.',
    'Restrictions budgétaires : le plafond baisse, la prescription raccourcit, et votre tampon vous est désormais loué. L’Administration reprend aussi les réclamations qui la visent.',
    'L’encre noire est réservée au deuil national. Les photos sont interdites. Les objets doivent consentir. Le guichet D n’a jamais existé ; merci de ne plus en parler.',
    'Ouverture dominicale exceptionnelle et obligatoire. Le Service du Ciel est dissous. Les Bernard ne sont plus recevables. M. Bernard Vautrin part en retraite : une contribution sera prélevée.'];
  function costsOf(day) {
    var c = [['Loyer', 30], ['Cantine obligatoire', 10]];
    if (day >= 3) c.push(['Amicale du personnel', 5]);
    if (day >= 5) c.push(['Location du tampon', 10]);
    if (day === 7) c.push(['Pot de départ de M. Vautrin', 15]);
    return c;
  }

  // ---------- Fabrique de dossiers ----------
  function draft(day, cat) {
    return { nom: pick(NOMS), prenom: pick(PRENOMS), num: 1000 + rnd(9000), cat: cat, objet: pick(OBJETS[cat]),
      jour: today(day) - rnd(6), montant: Math.random() < 0.6 ? 5 * (1 + rnd(20)) : 5 * (21 + rnd(60)),
      guichet: pick(['A', 'B', 'C', 'D']), encre: pick(['bleue', 'noire', 'noire', 'verte']), sig: 'own', sigName: '',
      attest: true, timbre: Math.random() < 0.3, photo: Math.random() < 0.5, domicile: Math.random() < 0.6, temoin: Math.random() < 0.3, consent: false,
      look: { skin: pick(['#e9c4a0', '#d9a57c', '#f1d3b8', '#b98058', '#8a5a3c']), hair: pick(['#2b2620', '#6b4a2f', '#a9a39a', '#c9a24a', '#7a2e1c']),
        coat: pick(['#4f5d73', '#6d5a4a', '#5a6b55', '#7a4b4b', '#3f3f46', '#8a7a4e']), cut: rnd(4), glasses: Math.random() < 0.35, beret: Math.random() < 0.2 } };
  }
  // Remet le dossier en règle, sauf sur l'article qu'on a volontairement enfreint
  function settle(d, day, checks, except) {
    for (var pass = 0; pass < 3; pass++) checks.forEach(function (r) { if (r !== except && !r.ok(d, day)) r.fix(d, day); });
  }
  function newDossier(day) {
    var tc = transmitCats(day), checks = active(day).filter(function (r) { return r.ok; });
    var sent = tc.length > 0 && Math.random() < 0.16;
    var cats = Object.keys(OBJETS).filter(function (c) { return (tc.indexOf(c) >= 0) === sent; });
    // Les articles nouveaux ou modifiés du jour sont enfreints plus souvent que les autres
    var pool = [];
    checks.forEach(function (r) { pool.push(r); if (day > 1 && changed(r, day)) pool.push(r, r); });
    var d, bad;
    for (var tries = 0; tries < 60; tries++) {
      var target = Math.random() < 0.55 ? pick(pool) : null;
      d = draft(day, pick(cats));
      settle(d, day, checks, null);
      if (target) { target.spoil(d, day); settle(d, day, checks, target); }
      bad = checks.filter(function (r) { return !r.ok(d, day); });
      if ((tc.indexOf(d.cat) >= 0) === sent && bad.length === (target ? 1 : 0) && (!target || bad[0] === target)) break;
    }
    // Le verdict attendu se lit toujours sur le dossier fini, jamais sur l'intention de départ
    d.bad = bad;
    d.verdict = tc.indexOf(d.cat) >= 0 ? 'transmit' : bad.length ? 'refuse' : 'approve';
    return d;
  }

  // ---------- Affichage ----------
  var G = { day: 1, money: 15, time: 0, running: false, busy: false, closing: false, dossier: null, motif: null, stats: null, total: { done: 0, errors: 0 } };

  function portrait(l) {
    var cuts = ['', '<path d="M28 44a22 22 0 0 1 44 0c-6-11-38-11-44 0z"/>',
      '<path d="M28 44a22 22 0 0 1 44 0c-6-11-38-11-44 0z"/><circle cx="50" cy="19" r="8"/>',
      '<path d="M25 74V44a25 25 0 0 1 50 0v30h-9V44c-8-9-24-9-32 0v30z"/>'];
    return '<svg viewBox="0 0 100 120" role="img" aria-label="Plaignant">' +
      '<path d="M10 120c0-30 16-44 40-44s40 14 40 44z" fill="' + l.coat + '"/>' +
      '<rect x="43" y="62" width="14" height="18" fill="' + l.skin + '"/>' +
      '<circle cx="50" cy="46" r="22" fill="' + l.skin + '"/>' +
      '<g fill="' + l.hair + '">' + cuts[l.cut] + '</g>' +
      (l.beret ? '<ellipse cx="50" cy="27" rx="25" ry="8" fill="#2a251e"/><rect x="49" y="15" width="2" height="6" fill="#2a251e"/>' : '') +
      '<circle cx="42" cy="47" r="2" fill="#2a251e"/><circle cx="58" cy="47" r="2" fill="#2a251e"/>' +
      (l.glasses ? '<g fill="none" stroke="#2a251e" stroke-width="1.5"><circle cx="42" cy="47" r="6"/><circle cx="58" cy="47" r="6"/><path d="M48 47h4"/></g>' : '') +
      '<path d="M44 58h12" stroke="#2a251e" stroke-width="1.5"/></svg>';
  }
  function replay(el) { el.classList.remove('out', 'in'); void el.offsetWidth; el.classList.add('in'); }
  function drawDossier(d) {
    var ink = 'hand ink-' + d.encre, row = function (k, v) { return '<dt>' + k + '</dt><dd class="' + ink + '">' + v + '</dd>'; };
    var pieces = PIECES.filter(function (p) { return d[p[0]]; }).map(function (p) { return '<li>' + p[1] + '</li>'; }).join('');
    var sig = d.sig === 'none' ? '' : d.sig === 'own' ? d.prenom + ' ' + d.nom : d.sigName;
    $('#dossier').innerHTML = '<p class="souche">Liasse en trois exemplaires : 1 bureau, 2 plaignant, 3 archives</p>' +
      '<div class="head"><span class="code">Formulaire R-27 bis</span><h2>Réclamation</h2><span class="num">N° ' + d.num + '</span></div>' +
      '<p class="recu">Guichet d’accueil <b>' + d.guichet + '</b></p><dl>' + row('Plaignant', d.prenom + ' ' + d.nom) + row('Catégorie', d.cat) + row('Objet', d.objet) +
      row('Date du préjudice', d.jour + ' novembre') + row('Indemnité demandée', d.montant + ' €') + '</dl>' +
      '<p class="pieces-title">Pièces jointes</p><ul class="pieces">' + (pieces || '<li class="none">Aucune</li>') + '</ul>' +
      '<p class="ink-note">Rédigé à l’encre ' + d.encre + '.</p>' +
      '<div class="sign"><small>Signature du plaignant</small><span class="' + ink + '">' + sig + '</span></div>';
    replay($('#dossier'));
    $('#visitor').innerHTML = portrait(d.look);
    replay($('#visitor'));
  }
  function drawRules() {
    $('#rules').innerHTML = active(G.day).map(function (r) {
      var tag = tagOf(r, G.day), body = '<b>Art. ' + r.art + '</b> ' + typo(textOf(r, G.day)) + (tag ? ' <em>' + tag + '</em>' : '');
      if (!r.ok) return '<li><p>' + body + '</p></li>';
      return '<li><button type="button" data-art="' + r.art + '" aria-pressed="' + (G.motif === r) + '"' + (G.motif === r ? ' class="sel"' : '') + '>' + body + '</button></li>';
    }).join('');
    $('#motif').textContent = G.motif ? 'Motif du refus : art. ' + G.motif.art + ' (' + G.motif.nom + ').' : 'Aucun motif de refus sélectionné.';
  }
  function hud() {
    var s = G.stats || { done: 0, errors: 0, pay: 0, fines: 0 };
    // L'éphéméride et l'horloge ne sont redessinées que quand elles changent
    if (+$('#day').dataset.day !== G.day) {
      $('#day').dataset.day = G.day;
      $('#day').innerHTML = '<small>novembre</small><b>' + today(G.day) + '</b><span>' + WEEK[G.day - 1] + '</span><small>jour ' + G.day + ' sur ' + DAYS + '</small>';
    }
    $('#done').textContent = s.done;
    $('#errors').textContent = s.errors;
    $('#pay').textContent = euro(s.pay - s.fines);
    $('#money').textContent = euro(G.money);
    var m = Math.floor((540 + Math.min(1, G.time / DAY_LEN) * 480) / 5) * 5;
    if (+$('#clock').dataset.m !== m) {
      $('#clock').dataset.m = m;
      $('#clock').innerHTML = '<b>' + Math.floor(m / 60) + '</b><i>h</i><b>' + ('0' + m % 60).slice(-2) + '</b>';
    }
    $('#clock').classList.toggle('late', G.closing);
  }
  function say(text) { $('#say').textContent = text; }
  function note(text, kind) { $('#slip').textContent = typo(text); $('#slip').className = 'slip ' + kind; }
  function card(html, label, fn, alt, altFn) {
    $('#card').innerHTML = typo(html) + '<div class="actions"><button type="button" id="go">' + label + '</button>' +
      (alt ? '<button type="button" class="alt" id="alt">' + alt + '</button>' : '') + '</div>';
    $('#veil').hidden = false;
    $('#go').onclick = fn;
    if (alt) $('#alt').onclick = altFn;
    $('#go').focus();
  }

  // ---------- Déroulement ----------
  function save() { try { localStorage.setItem(SAVE, JSON.stringify({ day: G.day, money: G.money, total: G.total })); } catch (e) { /* stockage indisponible */ } }
  function load() { try { return JSON.parse(localStorage.getItem(SAVE)); } catch (e) { return null; } }
  function forget() { try { localStorage.removeItem(SAVE); } catch (e) { /* stockage indisponible */ } }
  function fresh() { forget(); G.day = 1; G.money = 15; G.total = { done: 0, errors: 0 }; morning(); }

  function title() {
    var s = load(), again = s && s.day > 1 && s.day <= DAYS;
    card('<p class="ref">Ministère des Affaires courantes</p><h1>Bureau des réclamations</h1>' +
      '<p>Vous tenez le guichet 7 pendant sept jours. Les plaignants déposent un dossier ; vous le tamponnez.</p>' +
      '<ul><li><b>Approuvé</b> si le dossier respecte tout le règlement en vigueur.</li>' +
      '<li><b>Refusé</b> sinon, après avoir cliqué l’article enfreint dans le règlement.</li>' +
      '<li>Le règlement change chaque matin. Lisez la note de service.</li>' +
      '<li>Chaque dossier bien traité rapporte ' + euro(PRIME) + '. La première erreur du jour vaut avertissement, les suivantes ' + euro(AMENDE) + ' de retenue.</li>' +
      '<li>Le guichet ferme à 17 h. Le loyer, lui, tombe tous les soirs.</li></ul>',
      'Prendre son poste', fresh,
      again ? 'Reprendre au jour ' + s.day : '', function () { G.day = s.day; G.money = s.money; G.total = s.total; morning(); });
  }
  function morning() {
    var day = G.day, list = active(day).filter(function (r) { return day === 1 || changed(r, day); });
    G.stats = { done: 0, good: 0, half: 0, errors: 0, pay: 0, fines: 0 };
    G.time = 0; G.closing = false; G.dossier = null; G.motif = null;
    $('#dossier').innerHTML = ''; $('#visitor').innerHTML = ''; say(''); note('', '');
    $('#transmit').hidden = !transmitCats(day).length;
    drawRules(); hud();
    card('<p class="ref">Note de service n° ' + day + '</p><h1>' + dateOf(day).replace(/^./, function (c) { return c.toUpperCase(); }) + '</h1>' +
      '<p>' + MEMO[day] + '</p><h2>' + (day === 1 ? 'Règlement du jour' : 'Ce qui change au règlement') + '</h2><ul>' +
      list.map(function (r) { var tag = tagOf(r, day); return '<li><b>Art. ' + r.art + '</b> ' + (tag ? '<em>' + tag + '</em> ' : '') + textOf(r, day) + '</li>'; }).join('') +
      '</ul><h2>Retenues de ce soir</h2><p>' + costsOf(day).map(function (c) { return c[0] + ' ' + euro(c[1]); }).join(', ') + '.</p>',
      'Ouvrir le guichet', function () { $('#veil').hidden = true; G.running = true; next(); });
  }
  function next() {
    G.dossier = newDossier(G.day); G.motif = null;
    drawDossier(G.dossier); drawRules(); say(pick(HELLO));
  }
  function stamp(kind) {
    var d = G.dossier, s = G.stats;
    if (!G.running || G.busy || !d) return;
    if (kind === 'transmit' && !transmitCats(G.day).length) return;
    if (kind === 'refuse' && !G.motif) { note('Pour refuser, citez l’article enfreint : cliquez-le dans le règlement.', ''); return; }
    G.busy = true;
    var cite = d.bad.length ? 'art. ' + d.bad[0].art + ' (' + d.bad[0].nom + ')' : '', result, text;
    if (kind !== d.verdict) {
      result = 'err'; s.errors++;
      text = d.verdict === 'transmit' ? 'Erreur. Art. 9 : la catégorie ' + d.cat + ' devait être transmise sans examen.'
        : d.verdict === 'refuse' ? 'Erreur. Dossier irrecevable : ' + cite + '.'
        : kind === 'refuse' ? 'Erreur. Ce dossier était conforme. Le plaignant a déposé une réclamation.'
        : 'Erreur. Ce dossier relevait de votre guichet. Il vous a été retransmis, puis classé.';
      if (s.errors > 1) { s.fines += AMENDE; text += ' Retenue de ' + euro(AMENDE) + '.'; } else text += ' Premier avertissement du jour, sans retenue.';
    } else if (kind === 'refuse' && d.bad.indexOf(G.motif) < 0) {
      result = 'half'; s.half++; s.pay += PRIME / 2;
      text = 'Refus fondé, motif erroné : il fallait citer l’' + cite + '. Demi-prime.';
    } else {
      result = 'ok'; s.good++; s.pay += PRIME;
      text = pick(['Conforme.', 'Rien à signaler.', 'Travail noté.', 'Traitement régulier.']);
    }
    s.done++;
    $('#dossier').insertAdjacentHTML('beforeend', '<div class="mark ' + kind + '">' + MARKS[kind] + '</div>');
    say(pick(REPLIES[kind])); note(text, result); hud();
    setTimeout(function () { $('#dossier').classList.add('out'); $('#visitor').classList.add('out'); }, 750);
    setTimeout(function () { G.busy = false; if (G.closing) evening(); else next(); }, 1150);
  }
  function evening() {
    var s = G.stats, costs = costsOf(G.day), net = s.pay - s.fines, line = function (k, v, c) { return '<tr' + (c ? ' class="' + c + '"' : '') + '><td>' + k + '</td><td>' + v + '</td></tr>'; };
    costs.forEach(function (c) { net -= c[1]; });
    var before = G.money;
    G.running = false; G.dossier = null;
    G.money += net; G.total.done += s.done; G.total.errors += s.errors;
    hud();
    var html = '<p class="ref">Bilan du ' + dateOf(G.day) + '</p><h1>Le guichet est fermé</h1><table>' +
      line('Dossiers traités', s.done) + line('dont conformes au règlement', s.good) + line('dont refus mal motivés', s.half) + line('dont erreurs', s.errors) +
      line('Solde de la veille', euro(before), 'sum') + line('Primes', euro(s.pay)) + (s.fines ? line('Retenues pour erreurs', euro(-s.fines)) : '') +
      costs.map(function (c) { return line(c[0], euro(-c[1])); }).join('') + line('Nouveau solde', euro(G.money), 'sum') + '</table>';
    var verdict = '';
    if (G.money < 0) verdict = '<b>Mutation d’office.</b> Votre solde est négatif, ce que l’art. 6 ne prévoit pas. Vous êtes affecté aux Archives du sous-sol, où il n’y a ni guichet ni lumière.';
    else if (G.day === DAYS) {
      verdict = 'Semaine terminée : ' + G.total.done + ' dossiers, ' + G.total.errors + ' erreurs. ';
      verdict += G.total.errors <= 4 ? '<b>Promotion.</b> Vous êtes nommé sous-chef du Bureau des réclamations relatives au Bureau des réclamations. Votre premier dossier est le vôtre.'
        : G.total.errors <= 12 ? '<b>Maintien.</b> Votre notation est « sans objet ». Vous conservez votre guichet, votre tampon loué et votre lundi.'
        : '<b>Révocation.</b> Votre demande de maintien a été refusée au titre de l’art. 12. Vous n’êtes pas Bernard, mais le doute profite à l’Administration.';
    }
    if (verdict) { forget(); card(html + '<p class="verdict">' + verdict + '</p>', 'Recommencer', fresh); return; }
    G.day++; save();
    card(html, 'Rentrer dormir', morning);
  }

  // ---------- Entrées et horloge ----------
  $('#approve').onclick = function () { stamp('approve'); };
  $('#refuse').onclick = function () { stamp('refuse'); };
  $('#transmit').onclick = function () { stamp('transmit'); };
  $('#rules').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || !G.running) return;
    var r = RULES.filter(function (x) { return x.art === +b.dataset.art; })[0];
    G.motif = G.motif === r ? null : r;
    drawRules();
  });
  document.addEventListener('keydown', function (e) {
    if (!G.running || e.ctrlKey || e.altKey || e.metaKey) return;
    var kind = { a: 'approve', r: 'refuse', t: 'transmit' }[e.key.toLowerCase()];
    if (kind) stamp(kind);
  });

  var last = performance.now();
  function tick(now) {
    // Un onglet en arrière-plan ne fait pas passer la journée d'un coup
    var dt = Math.min(0.5, (now - last) / 1000); last = now;
    if (G.running) {
      G.time += dt;
      if (G.time >= DAY_LEN && !G.closing) { G.closing = true; note('17 h. Terminez ce dossier, puis le guichet ferme.', ''); }
      hud();
    }
    requestAnimationFrame(tick);
  }

  title();
  hud();
  requestAnimationFrame(tick);
})();
