(function (racine) {
  'use strict';

  // Le catalogue : des effets réglés pour être utilisés tels quels, pas des gabarits.
  // Chaque couche ne donne que ce qui s'écarte des valeurs par défaut du moteur (voir lecteur.js).
  var B = racine.Banc = racine.Banc || {};

  function effet(nom, w, h, images, cadence, sol, couches) {
    return { format: 'particules', version: 1, nom: nom, w: w, h: h, images: images, cadence: cadence, graine: 7, sol: sol || { actif: false, y: h - 4 }, couches: couches };
  }

  B.PREREGLAGES = [
    { id: 'feu', nom: 'Feu de camp', effet: effet('feu', 48, 48, 16, 12, null, [
      { nom: 'Flammes', emetteur: { forme: 'ligne', x: 24, y: 42, l: 14 }, debit: 70, vie: 0.85, vieVar: 0.35, vitesse: 22, vitesseVar: 0.5, dispersion: 14,
        gravite: -40, trainee: 1.6, turbulence: 70, turbEchelle: 7, forme: 'rond', taille0: 4, taille1: 1, tailleVar: 0.35,
        rampe: ['#ffd23f', '#ffb22a', '#ff8a1f', '#f2601c', '#d8421a', '#a8281a', '#5e1d1a'] },
      { nom: 'Cœur', emetteur: { forme: 'ligne', x: 24, y: 41, l: 8 }, debit: 40, vie: 0.3, vieVar: 0.3, vitesse: 14, vitesseVar: 0.4, dispersion: 10,
        gravite: -30, trainee: 1, turbulence: 40, turbEchelle: 6, forme: 'rond', taille0: 3, taille1: 1, rampe: ['#fffbe0', '#fff1a0', '#ffd23f'] },
      { nom: 'Braises', emetteur: { forme: 'ligne', x: 24, y: 40, l: 10 }, debit: 5, vie: 1.3, vieVar: 0.3, vitesse: 26, vitesseVar: 0.4, dispersion: 40,
        gravite: -12, turbulence: 140, turbEchelle: 6, rampe: ['#ffe39a', '#ff8f2c', '#c4421d'], scintille: 0.2 }
    ]) },
    { id: 'fumee', nom: 'Fumée', effet: effet('fumee', 48, 64, 24, 12, null, [
      { nom: 'Volutes', emetteur: { forme: 'ligne', x: 22, y: 58, l: 6 }, debit: 12, vie: 2.6, vieVar: 0.2, vitesse: 15, vitesseVar: 0.3, dispersion: 24,
        gravite: -4, vent: 5, trainee: 0.4, turbulence: 22, turbEchelle: 14, forme: 'rond', taille0: 3, taille1: 10, tailleVar: 0.25,
        rampe: ['#9a9aa2', '#7d7d86', '#64646c', '#4f4f57'], opacite0: 1, opacite1: 0.1 }
    ]) },
    { id: 'etincelles', nom: 'Étincelles', effet: effet('etincelles', 48, 48, 15, 15, { actif: true, y: 44 }, [
      { nom: 'Gerbe', emetteur: { forme: 'point', x: 24, y: 26 }, debit: 26, vie: 0.7, vieVar: 0.4, vitesse: 75, vitesseVar: 0.45, dispersion: 120,
        gravite: 230, trainee: 0.4, impact: 'rebond', rebond: 0.35, frottement: 0.4, forme: 'trait', etirement: 0.03,
        rampe: ['#ffffff', '#fff2a4', '#ffbc45', '#e8672a'] }
    ]) },
    { id: 'explosion', nom: 'Explosion', effet: effet('explosion', 64, 64, 16, 15, { actif: true, y: 58 }, [
      { nom: 'Fumée', emetteur: { forme: 'cercle', x: 32, y: 34, l: 12 }, salve: 14, debit: 0, vie: 0.96, vieVar: 0.1, vitesse: 16, vitesseVar: 0.3, radial: true, dispersion: 20,
        gravite: -16, trainee: 1.6, turbulence: 16, forme: 'rond', taille0: 5, taille1: 10, rampe: ['#6a625e', '#55504d', '#433f3d'], opacite0: 1, opacite1: 0 },
      { nom: 'Boule de feu', emetteur: { forme: 'cercle', x: 32, y: 34, l: 8 }, salve: 28, debit: 0, vie: 0.55, vieVar: 0.3, vitesse: 34, vitesseVar: 0.5, radial: true, dispersion: 30,
        gravite: -24, trainee: 3, forme: 'rond', taille0: 8, taille1: 2, tailleVar: 0.25, rampe: ['#ffffff', '#fff2aa', '#ffc84a', '#ff8a2e', '#d8461f', '#7a2a22'] },
      { nom: 'Débris', emetteur: { forme: 'point', x: 32, y: 34 }, salve: 16, debit: 0, vie: 0.9, vieVar: 0.15, vitesse: 85, vitesseVar: 0.4, dispersion: 360,
        gravite: 170, trainee: 0.8, impact: 'rebond', rebond: 0.3, frottement: 0.5, forme: 'carre', taille0: 2, taille1: 1, rampe: ['#ffe08a', '#d06a2a', '#5a3a2c'] }
    ]) },
    { id: 'pluie', nom: 'Pluie', effet: effet('pluie', 64, 64, 20, 20, { actif: true, y: 60 }, [
      { nom: 'Gouttes', emetteur: { forme: 'ligne', x: 40, y: -6, l: 96 }, debit: 55, vie: 0.6, vieVar: 0.05, vitesse: 190, vitesseVar: 0.1, angle: 196, dispersion: 3,
        gravite: 150, impact: 'disparait', forme: 'trait', etirement: 0.025, rampe: ['#b4cdea', '#86a9d3'], couleur: 'hasard' },
      { nom: 'Éclaboussures', emetteur: { forme: 'ligne', x: 32, y: 59, l: 64 }, debit: 30, vie: 0.2, vieVar: 0.3, vitesse: 34, vitesseVar: 0.3, dispersion: 100,
        gravite: 300, forme: 'carre', rampe: ['#d2e3f5', '#9dbbe0'] }
    ]) },
    { id: 'neige', nom: 'Neige', effet: effet('neige', 64, 64, 32, 12, null, [
      { nom: 'Flocons', emetteur: { forme: 'ligne', x: 32, y: -3, l: 76 }, debit: 13, vie: 7, vitesse: 9, vitesseVar: 0.4, angle: 180, dispersion: 30,
        gravite: 3.5, trainee: 0.35, turbulence: 9, turbEchelle: 20, forme: 'rond', taille0: 2, taille1: 2, tailleVar: 0.5,
        rampe: ['#ffffff', '#dce6f4'], couleur: 'hasard' }
    ]) },
    { id: 'poussiere', nom: 'Poussière', effet: effet('poussiere', 48, 32, 12, 12, { actif: true, y: 29 }, [
      { nom: 'Nuage', emetteur: { forme: 'ligne', x: 24, y: 28, l: 12 }, salve: 16, debit: 0, vie: 0.8, vieVar: 0.2, vitesse: 26, vitesseVar: 0.5, dispersion: 150,
        gravite: 24, trainee: 3.2, impact: 'rebond', rebond: 0, forme: 'rond', taille0: 2, taille1: 5, tailleVar: 0.3,
        rampe: ['#d2bf98', '#b19c77', '#917d5e'], opacite0: 1, opacite1: 0 }
    ]) },
    { id: 'bulles', nom: 'Bulles', effet: effet('bulles', 32, 64, 24, 12, null, [
      { nom: 'Bulles', emetteur: { forme: 'ligne', x: 16, y: 61, l: 14 }, debit: 5, vie: 3.2, vieVar: 0.2, vitesse: 12, vitesseVar: 0.3, dispersion: 10,
        gravite: -7, trainee: 0.5, turbulence: 26, turbEchelle: 8, forme: 'anneau', taille0: 2, taille1: 6, tailleVar: 0.3, rampe: ['#d8f3ff', '#9fd6f2'] }
    ]) },
    { id: 'magie', nom: 'Magie', effet: effet('magie', 48, 48, 16, 12, null, [
      { nom: 'Poudre', emetteur: { forme: 'cercle', x: 24, y: 24, l: 30 }, debit: 22, vie: 0.6, vieVar: 0.3, vitesse: 4, dispersion: 360,
        forme: 'carre', rampe: ['#efe6ff', '#a98bff', '#6d4fe0'], scintille: 0.35 },
      { nom: 'Étoiles', emetteur: { forme: 'cercle', x: 24, y: 24, l: 22, contour: true }, debit: 16, vie: 0.9, vieVar: 0.4, vitesse: 7, radial: true, dispersion: 40,
        gravite: -6, turbulence: 12, forme: 'plus', taille0: 5, taille1: 1, rampe: ['#ffffff', '#fff3a6', '#bdf2ff', '#9a7bff'], scintille: 0.2 }
    ]) },
    { id: 'feuilles', nom: 'Feuilles', effet: effet('feuilles', 64, 64, 48, 12, { actif: true, y: 61 }, [
      { nom: 'Feuilles', emetteur: { forme: 'ligne', x: 32, y: -3, l: 72 }, debit: 5, vie: 4.5, vieVar: 0.15, vitesse: 6, angle: 180, dispersion: 40,
        gravite: 15, vent: 3, trainee: 0.9, turbulence: 44, turbEchelle: 22, impact: 'arret', forme: 'carre', taille0: 2, taille1: 2,
        rampe: ['#d9822b', '#b5521f', '#e3b23c', '#8a3b1a', '#77802e'], couleur: 'hasard', opacite0: 1, opacite1: 0.35, scintille: 0.08 }
    ]) },
    { id: 'jet', nom: 'Jet d\'eau', effet: effet('jet', 48, 64, 16, 16, { actif: true, y: 61 }, [
      { nom: 'Gerbe', emetteur: { forme: 'point', x: 24, y: 58 }, debit: 55, vie: 1.15, vieVar: 0.1, vitesse: 74, vitesseVar: 0.1, dispersion: 20,
        gravite: 115, impact: 'disparait', forme: 'carre', taille0: 2, taille1: 1, rampe: ['#ffffff', '#c4e6ff', '#78b6ea', '#4282c8'] },
      { nom: 'Bouillons', emetteur: { forme: 'ligne', x: 24, y: 60, l: 20 }, debit: 20, vie: 0.3, vitesse: 14, dispersion: 120, gravite: 120,
        forme: 'carre', rampe: ['#e2f2ff', '#8fc0ec'] }
    ]) },
    { id: 'confettis', nom: 'Confettis', effet: effet('confettis', 64, 64, 32, 12, { actif: true, y: 62 }, [
      { nom: 'Confettis', emetteur: { forme: 'point', x: 32, y: 58 }, salve: 50, debit: 0, vie: 2.4, vieVar: 0.1, vitesse: 120, vitesseVar: 0.4, dispersion: 60,
        gravite: 90, trainee: 2.2, turbulence: 60, turbEchelle: 10, impact: 'arret', forme: 'carre', taille0: 2, taille1: 2,
        rampe: ['#e8443a', '#f6c63c', '#3aa0e8', '#4cc06a', '#c25ad8', '#ffffff'], couleur: 'hasard', scintille: 0.15 }
    ]) },
    { id: 'lucioles', nom: 'Lucioles', effet: effet('lucioles', 64, 48, 36, 12, null, [
      { nom: 'Lucioles', emetteur: { forme: 'rect', x: 32, y: 24, l: 54, h: 34 }, debit: 4, vie: 3, vieVar: 0.3, vitesse: 4, dispersion: 360,
        trainee: 1, turbulence: 20, turbEchelle: 16, forme: 'rond', taille0: 2, taille1: 1, rampe: ['#f6ffb0', '#c4ec52', '#7fae2c'], scintille: 0.12 }
    ]) },
    { id: 'soin', nom: 'Soin', effet: effet('soin', 32, 48, 18, 12, null, [
      { nom: 'Croix', emetteur: { forme: 'ligne', x: 16, y: 42, l: 20 }, debit: 9, vie: 1.3, vieVar: 0.2, vitesse: 16, vitesseVar: 0.3, dispersion: 10,
        gravite: -8, trainee: 0.6, forme: 'plus', taille0: 3, taille1: 3, rampe: ['#f2ffe6', '#9ae68a', '#3caa5a'], opacite0: 1, opacite1: 0.2 },
      { nom: 'Lueurs', emetteur: { forme: 'ligne', x: 16, y: 44, l: 24 }, debit: 14, vie: 0.8, vitesse: 22, dispersion: 6,
        forme: 'carre', rampe: ['#d6ffc9', '#6fcf6a'], scintille: 0.3 }
    ]) }
  ];
})(typeof window !== 'undefined' ? window : globalThis);
