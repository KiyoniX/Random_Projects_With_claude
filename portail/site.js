// Ce que toutes les pages du site ont en commun : l'icône d'onglet et l'onglet de retour à la ludothèque.
// Chaque page le charge en dernier ; il n'a besoin de rien et ne touche à rien d'autre.
(function () {
  'use strict';

  var HINT_KEY = 'portail-retour-vu';
  var HINT_MS = 3500;      // durée pendant laquelle l'onglet reste déplié à la première visite

  // Icône d'onglet de chaque projet : la tranche de sa boîte en miniature (fond, encre, lettre).
  var ICONS = {
    '': ['#24423c', '#d1a94e', 'R'],
    'atlas-des-mondes': ['#c4165c', '#ffffff', '1'],
    'langues-inventees': ['#c4165c', '#ffffff', '3'],
    'chroniques': ['#c4165c', '#ffffff', '2'],
    'steles': ['#c4165c', '#ffffff', '4'],
    'plans-de-ville': ['#e4d2aa', '#3d2f21', 'P'],
    'cartes-et-cachots': ['#000000', '#00ffff', 'C'],
    'siege': ['#e4d2aa', '#a3352a', 'S'],
    'riviere': ['#e4d2aa', '#2a5674', 'R'],
    'visite': ['#e4d2aa', '#8a3f2c', 'V'],
    'defense-ascii': ['#d8e9d3', '#c0211a', 'D'],
    'enquete': ['#c9a56a', '#9c2b22', 'N'],
    'flux': ['#f1f2ec', '#1d4f8c', 'F'],
    'usine': ['#f5b800', '#151515', 'U'],
    'dev-tycoon': ['#0a246a', '#ffffff', 'D'],
    'ville-a-regles': ['#0b4ea2', '#f4f3ec', 'V'],
    'backrooms': ['#00874a', '#ffffff', 'C'],
    'phare': ['#2f4038', '#dcc078', 'Q'],
    'bureau-des-reclamations': ['#d47a2a', '#fbfaf3', 'R'],
    'atelier-pixel': ['#2b2d35', '#f4f4f6', 'A'],
    'pantin': ['#2a2b2d', '#d2ab52', 'P'],
    'particules': ['#2b2c2f', '#f0762e', 'P'],
    'eclairage': ['#2a2b2d', '#ee8a3c', 'É'],
    'vitrail': ['#1f3d96', '#fbfaf3', 'V'],
    'textures': ['#a8452f', '#fff3e6', 'T'],
    'palettes': ['#3b2e63', '#ffe7a4', 'P'],
    'tuiles': ['#3f9a3c', '#f4f4f6', 'T'],
    'police-pixel': ['#ebe8e1', '#16171a', 'a'],
    'chiptune': ['#9bbc0f', '#1c2a5a', 'P'],
    'decompil-3ds': ['#1b5e36', '#eef1ea', '3']
  };

  var script = document.currentScript, home = script ? script.src.replace(/portail\/site\.js.*$/, 'index.html') : '';
  var parts = location.pathname.replace(/\/[^\/]*$/, '').split('/'), here = parts[parts.length - 1];
  var onShelf = !script || script.getAttribute('src').indexOf('..') < 0;   // la ludothèque le charge sans remonter d'un dossier

  // ---------- Icône ----------
  function icon(def) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="5" width="22" height="32" fill="' + def[0] + '"/>' +
      '<rect x="5" width="3" height="32" fill="#000" opacity=".25"/>' +
      '<text x="17" y="22" font-family="Georgia, serif" font-size="18" font-weight="700" text-anchor="middle" fill="' + def[1] + '">' + def[2] + '</text></svg>';
    var link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
    document.head.appendChild(link);
  }
  icon(onShelf || !ICONS[here] ? ICONS[''] : ICONS[here]);

  // ---------- Retour à la ludothèque ----------
  // Une étiquette de rayonnage qui dépasse de 7 pixels en haut de la fenêtre et descend quand on s'en approche.
  // Elle n'apparaît ni sur la ludothèque elle-même, ni dans ses aperçus (pages chargées dans un cadre).
  if (onShelf || window.self !== window.top || !home) return;

  var css = '#retour-ludotheque{all:initial;position:fixed;left:50%;top:0;z-index:2147483000;transform:translate(-50%,calc(-100% + 7px));' +
    'padding:6px 14px 8px;background:#f2e9d0;color:#211b14;font:700 14px/1.2 "Sitka Heading",Constantia,Georgia,serif;white-space:nowrap;cursor:pointer;' +
    'border-bottom:3px solid #d1a94e;box-shadow:0 2px 6px rgba(0,0,0,.35);transition:transform .16s ease-out}' +
    '#retour-ludotheque:hover,#retour-ludotheque:focus-visible,#retour-ludotheque.ouvert{transform:translate(-50%,0)}' +
    '#retour-ludotheque:focus-visible{outline:3px solid #d1a94e;outline-offset:2px}' +
    '#retour-ludotheque.annonce{pointer-events:none}' +
    '@media (prefers-reduced-motion:reduce){#retour-ludotheque{transition:none}}' +
    '@media print{#retour-ludotheque{display:none}}';
  var style = document.createElement('style'), tab = document.createElement('a'), seen = false;
  style.textContent = css;
  document.head.appendChild(style);
  tab.id = 'retour-ludotheque';
  tab.href = home;
  tab.textContent = 'Retour à la ludothèque';
  document.body.appendChild(tab);

  // Au doigt, il n'y a pas de survol : le premier appui déplie l'étiquette, le second la suit.
  tab.addEventListener('click', function (e) {
    if (e.pointerType !== 'touch' || tab.classList.contains('ouvert')) return;
    e.preventDefault();
    tab.classList.add('ouvert');
    setTimeout(function () { tab.classList.remove('ouvert'); }, HINT_MS);
  });

  try { seen = !!localStorage.getItem(HINT_KEY); localStorage.setItem(HINT_KEY, '1'); } catch (e) { /* stockage indisponible : pas de rappel */ }
  // À la première visite elle se montre d'elle-même ; les clics la traversent alors, pour ne bloquer aucune commande placée dessous.
  if (!seen) {
    tab.classList.add('ouvert', 'annonce');
    setTimeout(function () { tab.classList.remove('ouvert', 'annonce'); }, HINT_MS);
  }
})();
