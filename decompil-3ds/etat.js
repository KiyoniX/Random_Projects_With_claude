// Écrit par outils/verifier.py. Éditer etat.json, pas ce fichier.
window.ETAT = {
 "console": "New Nintendo 3DS XL, Luma3DS installée (boot9strap)",
 "objectif": "Trois buts liés. (1) La 3DS décompilée à 100 % : chaque module, le noyau, l'ARM9 et les mémoires de démarrage lus et nommés. (2) Pokémon X porté nativement sur PC, avec de meilleurs graphismes et de meilleures performances. (3) Un moteur de mods pour faire des romhacks et des fangames (nouveaux Pokémon, nouveaux assets), dont chaque mod tourne à la fois sur la 3DS (LayeredFS de Luma) et sur le portage PC.",
 "ouverture": "2026-10-13",
 "mise_a_jour": "2026-10-17",
 "prochaine_action": "Pousser le jeu plus loin par le cycle des trous sur des scénarios plus longs (combat, menus, changements de ville), puis l'écran tactile, le son (dsp_aac), et les applets. Écarts ouverts de la Carte : act sur 3dbrew à réextraire, act 0x1F, sessions de nfc.",
 "fonctions": {
  "total": 255374,
  "identifiees": 255374,
  "nommees": 15012,
  "reimplementees": 0,
  "typees": 0,
  "citees": 7495,
  "recompilees": 62490,
  "binaires": [
   {
    "nom": "ac",
    "ghidra": 1575,
    "manquees": 32,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 1607,
    "nommees": 330,
    "proposees_haute": 0,
    "proposees_moyenne": 52,
    "typees": 0,
    "citees": 341,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "ac-safe",
    "ghidra": 1569,
    "manquees": 33,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 1602,
    "nommees": 183,
    "proposees_haute": 0,
    "proposees_moyenne": 54,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "act",
    "ghidra": 1862,
    "manquees": 8,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 1870,
    "nommees": 125,
    "proposees_haute": 0,
    "proposees_moyenne": 56,
    "typees": 0,
    "citees": 100,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "am",
    "ghidra": 1081,
    "manquees": 73,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 1154,
    "nommees": 279,
    "proposees_haute": 0,
    "proposees_moyenne": 47,
    "typees": 0,
    "citees": 163,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "am-safe",
    "ghidra": 1082,
    "manquees": 72,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 1154,
    "nommees": 184,
    "proposees_haute": 0,
    "proposees_moyenne": 112,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "appleted",
    "ghidra": 2872,
    "manquees": 140,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 3012,
    "nommees": 0,
    "proposees_haute": 38,
    "proposees_moyenne": 79,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "arm9loader",
    "ghidra": 185,
    "manquees": 8,
    "fiche_seule": 5,
    "hors_compte": 5,
    "trouvees": 193,
    "nommees": 33,
    "proposees_haute": 7,
    "proposees_moyenne": 153,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "boot11",
    "ghidra": 227,
    "manquees": 13,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 240,
    "nommees": 109,
    "proposees_haute": 0,
    "proposees_moyenne": 9,
    "typees": 0,
    "citees": 39,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "boot9",
    "ghidra": 564,
    "manquees": 9,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 573,
    "nommees": 258,
    "proposees_haute": 0,
    "proposees_moyenne": 0,
    "typees": 0,
    "citees": 96,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "boss",
    "ghidra": 3690,
    "manquees": 49,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 3739,
    "nommees": 265,
    "proposees_haute": 0,
    "proposees_moyenne": 74,
    "typees": 0,
    "citees": 235,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "cabinet",
    "ghidra": 6615,
    "manquees": 452,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 7067,
    "nommees": 0,
    "proposees_haute": 27,
    "proposees_moyenne": 55,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "camera",
    "ghidra": 1029,
    "manquees": 2,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 1031,
    "nommees": 302,
    "proposees_haute": 0,
    "proposees_moyenne": 30,
    "typees": 0,
    "citees": 276,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "cecd",
    "ghidra": 1731,
    "manquees": 28,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 1759,
    "nommees": 160,
    "proposees_haute": 0,
    "proposees_moyenne": 69,
    "typees": 0,
    "citees": 162,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "cfg",
    "ghidra": 689,
    "manquees": 9,
    "fiche_seule": 1,
    "hors_compte": 11,
    "trouvees": 688,
    "nommees": 462,
    "proposees_haute": 0,
    "proposees_moyenne": 226,
    "typees": 0,
    "citees": 291,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "cfg-safe",
    "ghidra": 686,
    "manquees": 9,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 695,
    "nommees": 245,
    "proposees_haute": 0,
    "proposees_moyenne": 75,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "cherry",
    "ghidra": 3559,
    "manquees": 157,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 3716,
    "nommees": 0,
    "proposees_haute": 41,
    "proposees_moyenne": 113,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "codec",
    "ghidra": 235,
    "manquees": 18,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 253,
    "nommees": 193,
    "proposees_haute": 1,
    "proposees_moyenne": 57,
    "typees": 0,
    "citees": 92,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "codec-safe",
    "ghidra": 235,
    "manquees": 18,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 253,
    "nommees": 156,
    "proposees_haute": 6,
    "proposees_moyenne": 8,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "csnd",
    "ghidra": 457,
    "manquees": 2,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 459,
    "nommees": 115,
    "proposees_haute": 0,
    "proposees_moyenne": 25,
    "typees": 0,
    "citees": 60,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "csnd-safe",
    "ghidra": 456,
    "manquees": 2,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 458,
    "nommees": 102,
    "proposees_haute": 0,
    "proposees_moyenne": 30,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "ctrapp",
    "ghidra": 7573,
    "manquees": 180,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 7753,
    "nommees": 0,
    "proposees_haute": 51,
    "proposees_moyenne": 58,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "dlp",
    "ghidra": 1107,
    "manquees": 10,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 1117,
    "nommees": 95,
    "proposees_haute": 0,
    "proposees_moyenne": 51,
    "typees": 0,
    "citees": 63,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "dsp",
    "ghidra": 280,
    "manquees": 13,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 293,
    "nommees": 227,
    "proposees_haute": 0,
    "proposees_moyenne": 66,
    "typees": 0,
    "citees": 158,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "dsp-safe",
    "ghidra": 274,
    "manquees": 16,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 290,
    "nommees": 185,
    "proposees_haute": 5,
    "proposees_moyenne": 19,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "errdisp",
    "ghidra": 709,
    "manquees": 46,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 755,
    "nommees": 54,
    "proposees_haute": 5,
    "proposees_moyenne": 62,
    "typees": 0,
    "citees": 43,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "errdisp-safe",
    "ghidra": 709,
    "manquees": 46,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 755,
    "nommees": 50,
    "proposees_haute": 5,
    "proposees_moyenne": 64,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "error",
    "ghidra": 1674,
    "manquees": 98,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 1772,
    "nommees": 0,
    "proposees_haute": 39,
    "proposees_moyenne": 79,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "error-safe",
    "ghidra": 1675,
    "manquees": 101,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 1776,
    "nommees": 0,
    "proposees_haute": 38,
    "proposees_moyenne": 88,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "extrapad",
    "ghidra": 1743,
    "manquees": 105,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 1848,
    "nommees": 0,
    "proposees_haute": 39,
    "proposees_moyenne": 79,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "friend",
    "ghidra": 4516,
    "manquees": 265,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 4781,
    "nommees": 0,
    "proposees_haute": 43,
    "proposees_moyenne": 124,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "friends",
    "ghidra": 4666,
    "manquees": 33,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 4699,
    "nommees": 199,
    "proposees_haute": 0,
    "proposees_moyenne": 63,
    "typees": 0,
    "citees": 182,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "friends-safe",
    "ghidra": 4667,
    "manquees": 33,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 4700,
    "nommees": 186,
    "proposees_haute": 0,
    "proposees_moyenne": 68,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "fs",
    "ghidra": 1996,
    "manquees": 21,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 2017,
    "nommees": 350,
    "proposees_haute": 3,
    "proposees_moyenne": 23,
    "typees": 0,
    "citees": 412,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "gpio",
    "ghidra": 118,
    "manquees": 11,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 129,
    "nommees": 91,
    "proposees_haute": 1,
    "proposees_moyenne": 37,
    "typees": 0,
    "citees": 54,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "gpio-safe",
    "ghidra": 118,
    "manquees": 11,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 129,
    "nommees": 78,
    "proposees_haute": 5,
    "proposees_moyenne": 5,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "gsp",
    "ghidra": 431,
    "manquees": 31,
    "fiche_seule": 1,
    "hors_compte": 11,
    "trouvees": 452,
    "nommees": 321,
    "proposees_haute": 1,
    "proposees_moyenne": 130,
    "typees": 0,
    "citees": 206,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "gsp-safe",
    "ghidra": 415,
    "manquees": 31,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 446,
    "nommees": 227,
    "proposees_haute": 6,
    "proposees_moyenne": 22,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "hid",
    "ghidra": 303,
    "manquees": 18,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 321,
    "nommees": 234,
    "proposees_haute": 0,
    "proposees_moyenne": 87,
    "typees": 0,
    "citees": 143,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "hid-safe",
    "ghidra": 299,
    "manquees": 20,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 319,
    "nommees": 181,
    "proposees_haute": 5,
    "proposees_moyenne": 10,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "hmvp",
    "ghidra": 4860,
    "manquees": 330,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 5190,
    "nommees": 0,
    "proposees_haute": 32,
    "proposees_moyenne": 104,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "http",
    "ghidra": 739,
    "manquees": 48,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 787,
    "nommees": 348,
    "proposees_haute": 4,
    "proposees_moyenne": 18,
    "typees": 0,
    "citees": 338,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "http-safe",
    "ghidra": 692,
    "manquees": 48,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 740,
    "nommees": 187,
    "proposees_haute": 4,
    "proposees_moyenne": 35,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "i2c",
    "ghidra": 194,
    "manquees": 18,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 212,
    "nommees": 150,
    "proposees_haute": 0,
    "proposees_moyenne": 62,
    "typees": 0,
    "citees": 68,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "i2c-safe",
    "ghidra": 191,
    "manquees": 18,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 209,
    "nommees": 81,
    "proposees_haute": 4,
    "proposees_moyenne": 16,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "ir",
    "ghidra": 455,
    "manquees": 25,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 480,
    "nommees": 214,
    "proposees_haute": 6,
    "proposees_moyenne": 19,
    "typees": 0,
    "citees": 155,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "ir-safe",
    "ghidra": 432,
    "manquees": 25,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 457,
    "nommees": 167,
    "proposees_haute": 6,
    "proposees_moyenne": 28,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "kernel11",
    "ghidra": 988,
    "manquees": 36,
    "fiche_seule": 4,
    "hors_compte": 6,
    "trouvees": 1022,
    "nommees": 912,
    "proposees_haute": 0,
    "proposees_moyenne": 110,
    "typees": 0,
    "citees": 296,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "kernel9",
    "ghidra": 497,
    "manquees": 37,
    "fiche_seule": 16,
    "hors_compte": 34,
    "trouvees": 516,
    "nommees": 375,
    "proposees_haute": 5,
    "proposees_moyenne": 136,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "loader",
    "ghidra": 136,
    "manquees": 15,
    "fiche_seule": 0,
    "hors_compte": 9,
    "trouvees": 142,
    "nommees": 106,
    "proposees_haute": 0,
    "proposees_moyenne": 36,
    "typees": 0,
    "citees": 79,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "maj",
    "ghidra": 23883,
    "manquees": 905,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 24788,
    "nommees": 1256,
    "proposees_haute": 3,
    "proposees_moyenne": 60,
    "typees": 0,
    "citees": 522,
    "recompilees": 24635,
    "reimplementees": 0
   },
   {
    "nom": "mcu",
    "ghidra": 285,
    "manquees": 16,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 301,
    "nommees": 242,
    "proposees_haute": 0,
    "proposees_moyenne": 59,
    "typees": 0,
    "citees": 166,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "mcu-safe",
    "ghidra": 282,
    "manquees": 16,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 298,
    "nommees": 184,
    "proposees_haute": 5,
    "proposees_moyenne": 15,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "memolib",
    "ghidra": 1440,
    "manquees": 66,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 1506,
    "nommees": 0,
    "proposees_haute": 37,
    "proposees_moyenne": 83,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "menu",
    "ghidra": 8680,
    "manquees": 469,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 9149,
    "nommees": 0,
    "proposees_haute": 43,
    "proposees_moyenne": 113,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "mic",
    "ghidra": 179,
    "manquees": 18,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 197,
    "nommees": 121,
    "proposees_haute": 5,
    "proposees_moyenne": 5,
    "typees": 0,
    "citees": 95,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "mint",
    "ghidra": 4514,
    "manquees": 200,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 4714,
    "nommees": 0,
    "proposees_haute": 46,
    "proposees_moyenne": 114,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "mp",
    "ghidra": 726,
    "manquees": 50,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 776,
    "nommees": 55,
    "proposees_haute": 5,
    "proposees_moyenne": 27,
    "typees": 0,
    "citees": 54,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "mvd",
    "ghidra": 803,
    "manquees": 4,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 807,
    "nommees": 133,
    "proposees_haute": 0,
    "proposees_moyenne": 59,
    "typees": 0,
    "citees": 121,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "ndm",
    "ghidra": 880,
    "manquees": 3,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 883,
    "nommees": 234,
    "proposees_haute": 0,
    "proposees_moyenne": 26,
    "typees": 0,
    "citees": 227,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "news",
    "ghidra": 719,
    "manquees": 15,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 734,
    "nommees": 61,
    "proposees_haute": 0,
    "proposees_moyenne": 42,
    "typees": 0,
    "citees": 44,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "newslist",
    "ghidra": 3099,
    "manquees": 255,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 3354,
    "nommees": 0,
    "proposees_haute": 41,
    "proposees_moyenne": 114,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "nfc",
    "ghidra": 2389,
    "manquees": 9,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 2398,
    "nommees": 239,
    "proposees_haute": 0,
    "proposees_moyenne": 58,
    "typees": 0,
    "citees": 212,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "nim",
    "ghidra": 3466,
    "manquees": 30,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 3496,
    "nommees": 216,
    "proposees_haute": 0,
    "proposees_moyenne": 75,
    "typees": 0,
    "citees": 165,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "nim-safe",
    "ghidra": 1461,
    "manquees": 66,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 1527,
    "nommees": 38,
    "proposees_haute": 5,
    "proposees_moyenne": 35,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "ns",
    "ghidra": 938,
    "manquees": 51,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 989,
    "nommees": 336,
    "proposees_haute": 4,
    "proposees_moyenne": 31,
    "typees": 0,
    "citees": 328,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "ns-safe",
    "ghidra": 878,
    "manquees": 53,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 931,
    "nommees": 249,
    "proposees_haute": 5,
    "proposees_moyenne": 46,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "nwm",
    "ghidra": 2812,
    "manquees": 231,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 3043,
    "nommees": 241,
    "proposees_haute": 0,
    "proposees_moyenne": 73,
    "typees": 0,
    "citees": 182,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "nwm-safe",
    "ghidra": 2795,
    "manquees": 231,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 3026,
    "nommees": 203,
    "proposees_haute": 0,
    "proposees_moyenne": 88,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "olv",
    "ghidra": 18320,
    "manquees": 819,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 19139,
    "nommees": 0,
    "proposees_haute": 35,
    "proposees_moyenne": 98,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "pdn",
    "ghidra": 103,
    "manquees": 10,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 113,
    "nommees": 74,
    "proposees_haute": 0,
    "proposees_moyenne": 39,
    "typees": 0,
    "citees": 21,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "pdn-safe",
    "ghidra": 103,
    "manquees": 10,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 113,
    "nommees": 55,
    "proposees_haute": 5,
    "proposees_moyenne": 5,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "pm",
    "ghidra": 177,
    "manquees": 20,
    "fiche_seule": 0,
    "hors_compte": 9,
    "trouvees": 188,
    "nommees": 156,
    "proposees_haute": 0,
    "proposees_moyenne": 32,
    "typees": 0,
    "citees": 103,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "pnote_ap",
    "ghidra": 6624,
    "manquees": 69,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 6693,
    "nommees": 0,
    "proposees_haute": 66,
    "proposees_moyenne": 63,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "process9",
    "ghidra": 4797,
    "manquees": 24,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 4821,
    "nommees": 390,
    "proposees_haute": 0,
    "proposees_moyenne": 17,
    "typees": 0,
    "citees": 336,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "ps",
    "ghidra": 185,
    "manquees": 19,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 204,
    "nommees": 85,
    "proposees_haute": 5,
    "proposees_moyenne": 8,
    "typees": 0,
    "citees": 40,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "ps-safe",
    "ghidra": 185,
    "manquees": 19,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 204,
    "nommees": 69,
    "proposees_haute": 5,
    "proposees_moyenne": 14,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "ptm",
    "ghidra": 813,
    "manquees": 3,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 816,
    "nommees": 322,
    "proposees_haute": 0,
    "proposees_moyenne": 29,
    "typees": 0,
    "citees": 264,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "ptm-safe",
    "ghidra": 806,
    "manquees": 3,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 809,
    "nommees": 263,
    "proposees_haute": 0,
    "proposees_moyenne": 56,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "pxi",
    "ghidra": 152,
    "manquees": 4,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 156,
    "nommees": 111,
    "proposees_haute": 0,
    "proposees_moyenne": 45,
    "typees": 0,
    "citees": 95,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "qtm",
    "ghidra": 647,
    "manquees": 39,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 686,
    "nommees": 64,
    "proposees_haute": 2,
    "proposees_moyenne": 8,
    "typees": 0,
    "citees": 47,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "ro",
    "ghidra": 184,
    "manquees": 22,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 206,
    "nommees": 127,
    "proposees_haute": 4,
    "proposees_moyenne": 7,
    "typees": 0,
    "citees": 82,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "skater",
    "ghidra": 22775,
    "manquees": 427,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 23202,
    "nommees": 0,
    "proposees_haute": 65,
    "proposees_moyenne": 94,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "sm",
    "ghidra": 118,
    "manquees": 11,
    "fiche_seule": 0,
    "hors_compte": 3,
    "trouvees": 126,
    "nommees": 74,
    "proposees_haute": 0,
    "proposees_moyenne": 52,
    "typees": 0,
    "citees": 44,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "snote_ap",
    "ghidra": 4274,
    "manquees": 53,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 4327,
    "nommees": 0,
    "proposees_haute": 49,
    "proposees_moyenne": 59,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "socket",
    "ghidra": 829,
    "manquees": 46,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 875,
    "nommees": 145,
    "proposees_haute": 4,
    "proposees_moyenne": 19,
    "typees": 0,
    "citees": 148,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "socket-safe",
    "ghidra": 827,
    "manquees": 46,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 873,
    "nommees": 132,
    "proposees_haute": 4,
    "proposees_moyenne": 23,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "solv3",
    "ghidra": 4476,
    "manquees": 200,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 4676,
    "nommees": 0,
    "proposees_haute": 66,
    "proposees_moyenne": 134,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "spi",
    "ghidra": 143,
    "manquees": 17,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 160,
    "nommees": 101,
    "proposees_haute": 0,
    "proposees_moyenne": 59,
    "typees": 0,
    "citees": 33,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "spi-safe",
    "ghidra": 143,
    "manquees": 17,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 160,
    "nommees": 75,
    "proposees_haute": 4,
    "proposees_moyenne": 9,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "ssl",
    "ghidra": 2638,
    "manquees": 26,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 2664,
    "nommees": 138,
    "proposees_haute": 0,
    "proposees_moyenne": 43,
    "typees": 0,
    "citees": 114,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "ssl-safe",
    "ghidra": 2638,
    "manquees": 27,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 2665,
    "nommees": 104,
    "proposees_haute": 0,
    "proposees_moyenne": 53,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "swkbd",
    "ghidra": 2434,
    "manquees": 114,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 2548,
    "nommees": 0,
    "proposees_haute": 39,
    "proposees_moyenne": 90,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": "swkbd-safe",
    "ghidra": 2434,
    "manquees": 114,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 2548,
    "nommees": 0,
    "proposees_haute": 39,
    "proposees_moyenne": 90,
    "typees": 0,
    "citees": 0,
    "recompilees": 0,
    "reimplementees": 0
   },
   {
    "nom": ".cro (133 modules)",
    "ghidra": 37855,
    "manquees": 0,
    "fiche_seule": 0,
    "hors_compte": 0,
    "trouvees": 37855,
    "nommees": 200,
    "proposees_haute": 0,
    "proposees_moyenne": 0,
    "typees": 0,
    "citees": 0,
    "recompilees": 37855,
    "reimplementees": 0
   }
  ],
  "sans_analyse": 0
 },
 "paliers": [
  {
   "id": 1,
   "nom": "Extraire le jeu",
   "poids": 1,
   "but": "Avoir le code et les fichiers de Pokémon X (copie numérique installée) sur le PC, vérifiés, déchiffrés.",
   "taches": [
    {
     "t": "Dumper le titre installé avec GodMode9 (gestionnaire de titres, « Dump CXI/NDS file »)",
     "fait": true
    },
    {
     "t": "Dumper aussi la mise à jour du jeu si elle est installée (titre 0004000E…), c'est elle qui porte le code qui tourne",
     "fait": true
    },
    {
     "t": "Poser le fichier dans local/dump/ et lancer outils/inspecter.py",
     "fait": true
    },
    {
     "t": "Extraire exefs et romfs avec outils/extraire.py",
     "fait": true
    },
    {
     "t": "Noter l'empreinte SHA-256 du dump dans le journal",
     "fait": true
    }
   ]
  },
  {
   "id": 2,
   "nom": "Lire l'ARM sur sa propre vérité",
   "poids": 1,
   "but": "Reconnaître les formes d'un programme dont on connaît le code, avec REA qui lit et Ghidra qui vérifie.",
   "taches": [
    {
     "t": "Installer devkitPro avec le paquet 3ds-dev",
     "fait": true
    },
    {
     "t": "Brancher REA à Claude Code (paquet rea-agents, enregistrement par « rea setup »)",
     "fait": true
    },
    {
     "t": "Installer WSL avec Ubuntu, et y brancher REA et un Ghidra Linux : sous Windows, REA n'ouvre que des exécutables PE",
     "fait": true
    },
    {
     "t": "Compiler et lancer l'exercice 01 sur la console",
     "fait": false
    },
    {
     "t": "Faire lire ex01.bin par REA (chaîne « Exercice 01 », boucle, appels) et exiger les preuves",
     "fait": false
    },
    {
     "t": "Refaire l'exercice 01 à la main dans Ghidra et comparer avec ce que REA a dit",
     "fait": false
    },
    {
     "t": "Exercice 02 : l'aiguillage, avec REA puis à la main",
     "fait": false
    },
    {
     "t": "Exercice 03 : la sauvegarde, avec REA puis à la main",
     "fait": false
    },
    {
     "t": "Recompiler l'exercice 01 en -O2 : REA retrouve-t-il la même chose ?",
     "fait": false
    }
   ]
  },
  {
   "id": 3,
   "nom": "Ouvrir Pokémon X avec REA et Ghidra",
   "poids": 2,
   "but": "Se repérer dans le vrai binaire : point d'entrée, services, chaînes, lecteur de fichiers. REA cherche, Ghidra confirme.",
   "taches": [
    {
     "t": "Installer Ghidra et les scripts 3DS (SVC, handles, IPC, TLS)",
     "fait": true
    },
    {
     "t": "Envelopper code.bin en ELF à 0x00100000 (outils/elfer.py) et l'ouvrir dans Ghidra en ARM v6 ; c'est ce même ELF qu'on donne à REA",
     "fait": false
    },
    {
     "t": "Lancer les quatre scripts dans l'ordre",
     "fait": false
    },
    {
     "t": "Demander à REA le point d'entrée et la boucle principale, puis les vérifier dans Ghidra",
     "fait": false
    },
    {
     "t": "Demander à REA la fonction qui ouvre un fichier du romfs, avec ses preuves (chaîne, références, appel à fs:USER)",
     "fait": false
    },
    {
     "t": "Compter les fonctions avec REA et remplir le compteur de la fiche",
     "fait": false
    },
    {
     "t": "Passe de nommage automatique rejouable (outils/name_pass.py) : 1 239 fonctions de code.bin nommées, 194 dans les .cro",
     "fait": true
    },
    {
     "t": "Nommer les quelque 22 500 fonctions restantes (méthodes virtuelles, bibliothèques nn::os, gx, nnsnd)",
     "fait": false
    },
    {
     "t": "Poser les noms des modules .cro dans Ghidra (un chargement par module)",
     "fait": false
    }
   ]
  },
  {
   "id": 4,
   "nom": "Les formats du jeu, sur PC",
   "poids": 2,
   "but": "Lire les fichiers de Pokémon X avec nos propres outils : conteneurs, textes, tables, modèles.",
   "taches": [
    {
     "t": "Lecteur GARC (fait, testé en aller-retour sur des données fabriquées)",
     "fait": true
    },
    {
     "t": "Décompresseur LZ10 / LZ11 (fait, testé en aller-retour)",
     "fait": true
    },
    {
     "t": "Valider GARC et LZ11 sur les vrais fichiers du romfs",
     "fait": true
    },
    {
     "t": "Décoder les textes du jeu (décodeur écrit, à valider sur le romfs)",
     "fait": true
    },
    {
     "t": "Lire et réécrire les tables des Pokémon (statistiques, types, attaques apprises, évolutions, attaques d'œuf, attaques), à l'identique sur tout le dump (mods/modkit/formats/)",
     "fait": true
    },
    {
     "t": "Afficher un modèle BCH et une carte",
     "fait": false
    },
    {
     "t": "Niveau 3 du romfs refabriqué (arbre, tables de hachage), identique à l'original octet pour octet",
     "fait": true
    },
    {
     "t": "Moteur de mods (mods/) : format sans octet du jeu, empilement avec conflits, construction pour la console (LayeredFS de Luma) et pour le PC (banc --mod)",
     "fait": true
    },
    {
     "t": "Essayer un mod sur la console (LayeredFS, « Enable game patching » dans Luma)",
     "fait": false
    },
    {
     "t": "Appliquer les correctifs de code d'un mod sur le PC",
     "fait": false
    },
    {
     "t": "Lecteur et écrivain BCH pour de nouveaux modèles et textures",
     "fait": false
    },
    {
     "t": "Ajouter des lignes de texte, des espèces au-delà de 721 (correctifs de code), rencontres, dresseurs, objets, cartes, scripts",
     "fait": false
    }
   ]
  },
  {
   "id": 5,
   "nom": "Le jeu en direct sur la console",
   "poids": 2,
   "but": "Brancher GDB sur Pokémon X qui tourne, et relier ce qu'on voit à Ghidra.",
   "taches": [
    {
     "t": "Activer le serveur GDB de Rosalina sur le processus du jeu",
     "fait": false
    },
    {
     "t": "Se connecter depuis le PC avec le GDB de devkitARM",
     "fait": false
    },
    {
     "t": "Poser un point d'arrêt sur l'ouverture d'un fichier et lire la pile d'appels",
     "fait": false
    },
    {
     "t": "Lire les régions mémoire (monitor getmemregions) et les reporter sur la carte",
     "fait": false
    }
   ]
  },
  {
   "id": 6,
   "nom": "Réimplémenter des morceaux",
   "poids": 3,
   "but": "Réécrire en C des fonctions du jeu et prouver qu'elles donnent le même résultat.",
   "taches": [
    {
     "t": "Choisir dix fonctions feuilles (maths, lecture de conteneur, décompression)",
     "fait": false
    },
    {
     "t": "Faire produire par REA le pseudo-code de chacune, le relire ligne à ligne contre le désassemblage",
     "fait": false
    },
    {
     "t": "Les réécrire et les tester contre des traces prises sur la console",
     "fait": false
    },
    {
     "t": "Tenir le compteur de fonctions réimplémentées",
     "fait": false
    }
   ]
  },
  {
   "id": 7,
   "nom": "La couche système sur PC",
   "poids": 4,
   "but": "Fournir sur PC tout ce que le jeu demande à la 3DS : fichiers, écran, manette, son.",
   "taches": [
    {
     "t": "Lister tous les services que le jeu appelle",
     "fait": true
    },
    {
     "t": "Une fiche pour chaque module que Pokémon X appelle (22 sur 22)",
     "fait": true
    },
    {
     "t": "Banc d'essai (banc/) : le code du jeu sous unicorn, la couche système en Python d'après les contrats, jusqu'au terrain",
     "fait": true
    },
    {
     "t": "Choisir la voie : recompilation statique de l'ARM11 ou décompilation",
     "fait": true
    },
    {
     "t": "Fichiers et manette",
     "fait": false
    },
    {
     "t": "Le GPU PICA200 vers la carte graphique (portage/, Rust + wgpu sous Vulkan) : écran-titre, menu et terrain rendus et comparés au banc",
     "fait": true
    },
    {
     "t": "Le son",
     "fait": false
    },
    {
     "t": "Premier écran du jeu affiché sur PC",
     "fait": true
    },
    {
     "t": "Rendu PICA : éclairage par fragment, brouillard, pochoir, opérations logiques, ciseaux qui excluent (banc/pica/)",
     "fait": true
    },
    {
     "t": "Outil d'enregistrement et de rejeu des images du GPU (banc/pica/replay.py)",
     "fait": true
    },
    {
     "t": "Le terrain dessine sur le banc (listes chaînées par les registres de saut suivies)",
     "fait": true
    },
    {
     "t": "Mipmaps, shaders de géométrie, flottants de 24 bits : à relever dans les listes du terrain quand il dessinera",
     "fait": false
    },
    {
     "t": "Rendre vrais sur PC ce que les fiches disent vrai : l'aléa de ssl, les fichiers de boîte de cecd, les sockets et le DNS de socket",
     "fait": false
    },
    {
     "t": "Tracer au banc la création d'un socket TCP (le jeu envoie le protocole 6, le module refuse tout protocole non nul)",
     "fait": false
    },
    {
     "t": "Le terrain dessiné en entier par la référence numpy (palais Chaydeuvre)",
     "fait": true
    },
    {
     "t": "Corriger les réponses factices de nwm::UDS du banc d'après sa fiche (Initialize rend une vraie poignée d'événement, GetConnectionStatus 3, StartScan, CreateNetwork2)",
     "fait": true
    },
    {
     "t": "Rendre nwm::UDS vrai sur le réseau du PC, pour les échanges et les combats",
     "fait": false
    },
    {
     "t": "Reporter dans la Carte des services les écarts relevés par les fiches de nwm et de boss",
     "fait": true
    },
    {
     "t": "Portage Rust : format de capture neutre .picacap, rejeu à l'échelle 1 à 4, comparaison au banc numpy",
     "fait": true
    },
    {
     "t": "Portage Rust : lecture des mods par overlay.json (crate overlay, format 1)",
     "fait": true
    },
    {
     "t": "Portage Rust : noyau et services réécrits, chacun vérifié contre le banc Python",
     "fait": true
    },
    {
     "t": "Portage Rust : appeler le code du jeu recompilé en C depuis Rust",
     "fait": true
    },
    {
     "t": "Portage Rust : textures remplaçables par les mods (dossier pc/ d'un mod)",
     "fait": false
    },
    {
     "t": "Mipmaps et niveaux de détail (aucune scène vue ne les demande encore)",
     "fait": false
    },
    {
     "t": "Shader de géométrie en mode primitive variable, et une première capture du jeu qui en utilise un",
     "fait": false
    },
    {
     "t": "Portage Rust : tenir 60 images par seconde au terrain (regrouper les passes, réutiliser les tampons, relire le GPU seulement quand gsp lit la mémoire)",
     "fait": true
    },
    {
     "t": "Portage Rust : une texture rendue puis réutilisée garde la définition de l'échelle choisie",
     "fait": true
    },
    {
     "t": "Services du banc alignés sur les fiches : 13 services d'après leurs fiches, l'en-tête de chaque commande vérifié",
     "fait": true
    },
    {
     "t": "Relire cecd:u en jouant, quand le jeu l'appelle (dispositions de requêtes interprétées)",
     "fait": false
    },
    {
     "t": "Trancher les points douteux des fiches relevés par le banc (nwm GetApplicationData, friends GetServerTimeDifference, ac ConnectAsync hors ligne, boss UnregisterTask)",
     "fait": false
    },
    {
     "t": "Portage Rust : cache des pipelines sur disque (la première image prend encore 60 à 90 ms)",
     "fait": false
    },
    {
     "t": "Portage Rust : fenêtre en direct sans relecture du GPU (Pica::readback = false)",
     "fait": true
    },
    {
     "t": "Processeur natif branché dans le banc (--cpu hybride) jusqu'à DllField, sans faute",
     "fait": true
    },
    {
     "t": "Mode vérification natif contre unicorn sans divergence (1,2 s de banc, 5 677 tranches)",
     "fait": true
    },
    {
     "t": "Recompiler aussi les modules .cro et les brancher dans le banc (133 modules, C relogeable)",
     "fait": true
    },
    {
     "t": "Réduire le coût des traversées entre le code natif et unicorn",
     "fait": false
    },
    {
     "t": "Fiches des huit modules proches du matériel (gpio, pdn, i2c, spi, mcu, codec, csnd, ps)",
     "fait": true
    },
    {
     "t": "Fiches des neuf derniers modules système (am, news, act, dlp, mp, nfc, mvd, nim, qtm)",
     "fait": true
    },
    {
     "t": "Reporter dans la Carte des services les écarts des fiches matérielles (gpio, i2c, spi, mcu, codec, ps)",
     "fait": true
    },
    {
     "t": "Variantes « safe » des modules comparées à leur module normal (fiches/safe.md, 23 sur 23)",
     "fait": true
    },
    {
     "t": "Lire nim-safe à part (3 % de code commun avec nim)",
     "fait": false
    },
    {
     "t": "Reporter dans la Carte des services les écarts des neuf dernières fiches (appelle, appelants, commandes de nfc, nim, act, news, am)",
     "fait": true
    },
    {
     "t": "Relancer emulate_dispatch.py avec --helper sur nfc, nim et mvd (aiguillages peut-être sous-évalués)",
     "fait": false
    },
    {
     "t": "Compléter la fiche de nim (32 commandes sans gestionnaire localisé)",
     "fait": false
    },
    {
     "t": "Finir le cycle des trous de code.bin révélés par le natif (viser moins de 100 s de PC pour 24 s de banc)",
     "fait": false
    },
    {
     "t": "--cpu verifier sur des tranches qui passent par les .cro recompilés",
     "fait": false
    },
    {
     "t": "Profiler le Python du banc (environ 115 s sur 330)",
     "fait": false
    },
    {
     "t": "Portage Rust : brancher pica sur les transferts de gsp (l'écran-titre en direct dans la fenêtre)",
     "fait": true
    },
    {
     "t": "Portage Rust : comparer au banc avec --mod (au-delà de 3 s : fait, 56 014 lignes identiques sur 20 s)",
     "fait": false
    },
    {
     "t": "Fichiers et manette : entrées réelles et écran tactile dans le runtime Rust",
     "fait": false
    }
   ]
  }
 ],
 "outils": [
  {
   "id": "rea",
   "nom": "REA (Reverse Engineer Anything)",
   "role": "L'outil principal du parcours : un serveur MCP qui donne à Claude Code la main sur Ghidra (pseudo-code, chaînes, références, symboles) et exige les preuves de chaque conclusion. On lui demande, puis on vérifie dans Ghidra. La version Windows n'ouvre que des exécutables PE x86 : pour notre ARM, c'est l'entrée « rea-wsl » (REA et Ghidra dans Ubuntu sous WSL, ARM v6 imposé), branchée le 2026-10-13. Voir outils/REA.md.",
   "ou": "Paquet npm rea-agents 6.4.0 : « rea » (Windows) et « rea-wsl » (Ubuntu) dans ~/.claude.json",
   "lieu": "pc",
   "present": false,
   "lien": "https://github.com/morluto/rea",
   "note": "Paquet installé, déclaration MCP absente, Node 22+ présent"
  },
  {
   "id": "luma",
   "nom": "Luma3DS + Rosalina",
   "role": "Le firmware custom de la console. Son menu Rosalina (L + Bas + Select) ouvre un serveur GDB sur n'importe quel processus.",
   "ou": "Sur la console",
   "lieu": "console",
   "present": true,
   "lien": "https://github.com/LumaTeam/Luma3DS"
  },
  {
   "id": "godmode9",
   "nom": "GodMode9",
   "role": "Explorateur de fichiers de la console. Son gestionnaire de titres dumpe un jeu installé, déchiffré, en .cxi.",
   "ou": "Sur la console (Start au démarrage), version 2.2.3 dans luma/payloads",
   "lieu": "console",
   "present": true,
   "lien": "https://github.com/d0k3/GodMode9"
  },
  {
   "id": "ctrtool",
   "nom": "ctrtool 1.3.0",
   "role": "Ouvre un dump : sépare le code (exefs) des fichiers (romfs), lit les en-têtes.",
   "ou": "local/outils/ctrtool/",
   "lieu": "pc",
   "present": true,
   "lien": "https://github.com/3DSGuy/Project_CTR"
  },
  {
   "id": "makerom",
   "nom": "makerom 0.19.0",
   "role": "Refabrique un .cia ou un .3ds à partir de fichiers modifiés. Servira pour tester des patchs.",
   "ou": "local/outils/makerom/",
   "lieu": "pc",
   "present": true,
   "lien": "https://github.com/3DSGuy/Project_CTR"
  },
  {
   "id": "ghidra",
   "nom": "Ghidra 12.1.4",
   "role": "Le désassembleur et décompilateur. Gratuit, tourne sur Java 21.",
   "ou": "local/outils/ghidra/",
   "lieu": "pc",
   "present": true,
   "lien": "https://github.com/NationalSecurityAgency/ghidra"
  },
  {
   "id": "scripts",
   "nom": "Scripts Ghidra 3DS",
   "role": "Quatre scripts qui étiquettent les appels système, les handles de services, les fonctions IPC et le stockage par fil. À lancer dans cet ordre.",
   "ou": "local/outils/ghidra-scripts/",
   "lieu": "pc",
   "present": true,
   "lien": "https://github.com/zaksabeast/3ds-Ghidra-Scripts"
  },
  {
   "id": "devkitpro",
   "nom": "devkitPro, libctru, GDB (devkitARM gcc 16.1.0)",
   "role": "La chaîne de compilation des homebrews et le GDB qui parle à Rosalina. Installateur graphique, puis le paquet 3ds-dev.",
   "ou": "C:\\devkitPro",
   "lieu": "pc",
   "present": false,
   "lien": "https://devkitpro.org/wiki/Getting_Started"
  },
  {
   "id": "azahar",
   "nom": "Azahar",
   "role": "L'émulateur, successeur de Citra. Pour tracer sans toucher à la console.",
   "ou": "Installation à part",
   "lieu": "pc",
   "present": false,
   "lien": "https://azahar-emu.org"
  },
  {
   "id": "python",
   "nom": "Python 3.12",
   "role": "Les scripts du dossier outils/ : vérification, inspection, GARC, LZ11.",
   "ou": "Déjà sur le PC",
   "lieu": "pc",
   "present": true,
   "lien": ""
  },
  {
   "id": "3dbrew",
   "nom": "3dbrew",
   "role": "La documentation de référence sur tout le système. La carte ci-dessous y renvoie.",
   "ou": "En ligne",
   "lieu": "web",
   "present": true,
   "lien": "https://www.3dbrew.org"
  },
  {
   "id": "pk3ds",
   "nom": "pk3DS, Ohana3DS, SPICA",
   "role": "Les outils de la communauté Project Pokémon : éditeurs de tables, visionneuses de modèles. Références pour nos propres lecteurs.",
   "ou": "En ligne",
   "lieu": "web",
   "present": true,
   "lien": "https://github.com/kwsch/pk3DS"
  }
 ],
 "journal": [
  {
   "date": "2026-10-13",
   "texte": "Ouverture du carnet. La console a déjà Luma3DS. Objectif fixé : Pokémon X natif sur PC. Deux projets de décompilation existent sur GitHub, l'un à un commit, l'autre à six, sans une fonction décompilée : on part de zéro, en sachant que personne n'a terminé une décompilation de jeu 3DS."
  },
  {
   "date": "2026-10-13",
   "texte": "Écrit le lecteur GARC et le décompresseur LZ10/LZ11 d'après le code de pk3DS, avec un test aller-retour sur des données fabriquées. Reste à les valider sur le vrai romfs quand le dump sera là."
  },
  {
   "date": "2026-10-13",
   "texte": "Écrit les trois premiers exercices à vérité connue (boucle, aiguillage, sauvegarde). Ils attendent devkitPro pour être compilés."
  },
  {
   "date": "2026-10-13",
   "texte": "Écrit outils/texte.py, le décodeur et encodeur des textes de X/Y d'après TextFile.cs de pk3DS : clé 0x7C89 + 0x2983 par ligne, rotation de 3 bits par caractère, variables sous la forme [VAR TRNAME]. Testé en aller-retour sur des lignes fabriquées (accents, retours à la ligne, variables) ; reste à le valider sur les GARC de texte du vrai romfs (a/0/7/2 et a/0/8/0, plus le numéro de langue). Makefile des exercices recalé sur le gabarit devkitPro (icône intégrée au .3dsx, recompilation quand OPT change)."
  },
  {
   "date": "2026-10-13",
   "texte": "REA 6.4.0 installé et branché à Claude Code par « rea setup » (enregistrement dans ~/.claude.json, GHIDRA_INSTALL_DIR vers le Ghidra local). Son diagnostic est sain, il voit Ghidra 12.1.4 et Java 21. Mais essai fait : sous Windows il refuse l'ARM, brut (« unsupported binary format ») comme enveloppé en ELF (son Ghidra Windows n'accepte que des PE). Pour qu'il serve, il faudra le faire tourner sous WSL avec un Ghidra Linux. Procédures dans outils/REA.md et outils/GHIDRA.md."
  },
  {
   "date": "2026-10-13",
   "texte": "Écrit outils/elfer.py : enveloppe code.bin dans un ELF ARM chargé à 0x00100000, en trois segments si l'exheader est à côté, pour que Ghidra et REA l'ouvrent à la bonne adresse sans réglage. Les scripts Ghidra 3DS sont écrits pour Jython, que Ghidra 12 ne lance plus par défaut : installer.py déballe l'extension Jython livrée avec Ghidra et pose l'en-tête « @runtime Jython » sur les quatre scripts."
  },
  {
   "date": "2026-10-13",
   "texte": "Terrain préparé pour la journée du 14 : programme dans JOURNEE.md (sauvegarde NAND, boot9/boot11, FIRM déchiffré, modules système hid, sm, fs… dumpés par le gestionnaire de titres, puis hid lu dans Ghidra avant Pokémon X). Téléchargés dans local/ : l'installateur devkitPro 3.0.3, GodMode9 2.2.3 et ftpd 3.2.1, assemblés dans local/sd/ prêts à copier sur la microSD. extraire.py sait maintenant ouvrir un FIRM et ranger plusieurs dumps côte à côte (local/extrait/<nom>/). Trois outils voisins livrés sur le site : Explorateur de romfs, Visionneuse BCH, et la Carte des services en cours."
  },
  {
   "date": "2026-10-13",
   "texte": "Console jointe par Wi-Fi : le port USB ne fait que charger, tout passe par ftpd (déjà installé sur la console, port 5000, environ 1,2 Mo/s mesuré). GodMode9 y était en 2.2.1 : sauvegardé dans local/sauvegarde-sd/, remplacé par le 2.2.3 avec ses fichiers de langue, relu par FTP et identique à l'octet (SHA-256 596a3d5a…49c9cc). Les scripts gm9 étaient déjà les mêmes. Vu sur la carte : Pokémon X est bien installé (titre 0004000000055D00, 1,8 Go) avec sa mise à jour (0004000E00055D00, 32 Mo). Aucune sauvegarde NAND sur la carte : gm9/backups est vide, gm9/out n'existe pas encore."
  },
  {
   "date": "2026-10-13",
   "texte": "Les dumps sont sur le PC, rapatriés par ftpd : Pokémon X (pokemon-x.cxi, 1 801 052 160 octets, titre 0004000000055D00, CTR-P-EKJA, SHA-256 2d8e60a50b13feb3e3e140ea2735aa42ac37c354ca2b7a41f056e7bfba65e018) et sa mise à jour (pokemon-x_maj.cxi, 31 715 328 octets, titre 0004000E00055D00, CTR-U-EKJA, SHA-256 7ad0f74531dfc18aaee70a9705f408561dbf65c06e373d95df00cf1e975e3c66), tous deux déchiffrés. Dans GodMode9, le gestionnaire de titres s'ouvre par le bouton HOME (« Gestionnaire d'applications », puis [A:] CARTE SD), pas par le dossier title : notes corrigées. Extraction : le jeu dans local/extrait/ (code.bin de 5 156 864 octets, romfs de 653 fichiers pour 1,7 Go, 272 GARC), la mise à jour dans local/extrait/maj/ (code.bin de 5 169 152 octets, 147 fichiers, 12 GARC). C'est le code de la mise à jour qui tourne : c'est maj/exefs/code.elf qu'il faudra ouvrir dans Ghidra (.text de 4,45 Mo à 0x00100000, .rodata à 0x0053F000, .data à 0x005A9000)."
  },
  {
   "date": "2026-10-13",
   "texte": "Premier contact des outils avec les vrais fichiers. GARC : les 272 conteneurs du jeu et les 12 de la mise à jour sont lus sans erreur. Textes : texte.py décode tous les fichiers des seize GARC de texte, 151 fichiers et 27 605 lignes par langue dans a/0/7/2 à 9 (gametext), 424 fichiers et 7 607 lignes dans a/0/8/0 à 7 (storytext). Ordre des langues vérifié : japonais kana, japonais kanji, anglais, français, italien, allemand, espagnol, coréen ; le français est donc a/0/7/5 et a/0/8/3. À traiter plus tard : le caractère privé U+E07F qui sort devant « ? » en français (l'espace fine de la police du jeu). LZ11 : 3 993 sous-fichiers compressés décompressés à la taille annoncée, 105,6 Mo en tout ; les 7 refus sont de petites tables non compressées (16 à 490 octets) qui commencent par hasard par 0x11."
  },
  {
   "date": "2026-10-13",
   "texte": "Poste prêt. devkitPro installé par son installateur (tous les composants, devkitARM gcc 16.1.0, GDB, libctru) : son mode silencieux saute l'installation, il faut passer par ses fenêtres. Les trois exercices compilent du premier coup en -O0 et sont posés dans 3ds/ sur la console. Ubuntu 26.04 installé sous WSL sans redémarrage, avec Java 21, Node 22, rea-agents 6.4.0 en global et Ghidra copié dans /opt/ghidra : REA y ouvre l'ELF ARM de l'exercice 01 et retrouve « Exercice 01 : la boucle » à 0x118000, ce que la version Windows refusait. Serveur MCP enregistré sous le nom rea-wsl, à côté de rea."
  },
  {
   "date": "2026-10-13",
   "texte": "Sauvegarde NAND faite dans GodMode9 et rapatriée par ftpd dans local/dump/nand.bin : 1 979 711 488 octets (0x76000000, la taille d'une NAND de New 3DS), en-tête NCSD présent, SHA-256 315b6becb9dcdc48664c47321bb1dae1704618708dc197858780b5c18b50b6fc. Cette empreinte est celle de la copie du PC : elle n'a pas encore été comparée à celle de la console (dans GodMode9, A sur 0:/gm9/out/nand.bin, calculer le SHA-256). Tant que ce n'est pas fait, garder la copie de la carte."
  },
  {
   "date": "2026-10-13",
   "texte": "La console elle-même, rapatriée dans local/dump/systeme/ : boot9.bin (65 536 octets, SHA-256 2f88744f…bf28166f), le NATIVE_FIRM de New 3DS (titre 0004013820000002, 999 424 octets, section ARM9 déchiffrée par GodMode9 : on y lit « Process9 ») et six modules dumpés par le gestionnaire de titres : dsp, cfg, ns, nwm, et gsp et ptm dans leur version New 3DS (0004013020001C02 et 0004013020002202, les seules installées). Manquent encore boot11.bin et hid (0004013000001D02 ; c'est nwm, 2D02, qui a été dumpé à sa place). Deux erreurs des notes corrigées : firm0.bin contient boot9strap et non le système, le vrai FIRM est un titre de la CTRNAND ; et sm, fs, pm, loader, pxi ne sont pas des titres, ils sont rangés dans le FIRM (3dbrew, « Title list »)."
  },
  {
   "date": "2026-10-13",
   "texte": "Le FIRM a trois sections : les cinq modules de démarrage à 0x1FF00000, kernel11 à 0x1FF80000, l'ARM9 à 0x08006000. extraire.py sort maintenant ces cinq modules en .cxi (ce sont des NCCH posés bout à bout), et les onze modules sont extraits dans local/extrait/<nom>/. elfer.py corrigé sur deux points appris ici : dans le code.bin d'un module du FIRM les sections .text, .rodata et .data se suivent sans remplissage de page (vérifié : .text finit sur « bx lr », .rodata commence par « srv: »), et loader est chargé à 0x14000000, pas à 0x00100000. Les onze code.elf ont leurs trois segments."
  },
  {
   "date": "2026-10-13",
   "texte": "Les deux manquants sont là : boot11.bin (65 536 octets, SHA-256 74daace1…a7a07512) et hid (0004013000001D02, 35 840 octets, SHA-256 16cf0794…1581b265), extrait dans local/extrait/hid/ avec son code.elf en trois segments (53 248 octets de code ; on y lit hid:USER, hid:SPVR, hid:QTM, hid:NFC). La sauvegarde NAND est vérifiée : le SHA-256 calculé par GodMode9 sur la carte (nand.bin.sha) est identique, sur ses 64 chiffres, à celui de la copie du PC. Tout le matériel de la journée du 14 est sur le PC."
  },
  {
   "date": "2026-10-13",
   "texte": "Essai de reverse semi-automatique sur sm, avec REA sous WSL tenu ouvert en une seule session (15 s par question au lieu de 2 min 20). Résultat dans fiches/sm.md et fiches/sm.noms.tsv : la boucle de service à 0x1000a0, les deux gestionnaires (srv: à 0x103a44, srv:pm à 0x103930), les 18 commandes rattachées chacune à sa fonction et recoupées avec les en-têtes de 3dbrew, GetServiceHandle décrit pas à pas, 40 fonctions nommées sur 110. Piège à retenir pour tous les modules : Ghidra ne crée pas de fonction pour ce qui n'est appelé que par une table de pointeurs (ici le gestionnaire de srv: lui-même) ; il faut balayer les données à la recherche de pointeurs vers du code et les donner à REA en graines (REA_GHIDRA_SEED_FILE), ce qui a fait passer sm de 102 à 110 fonctions. Le pseudo-code brut reste dans local/analyse/sm/."
  },
  {
   "date": "2026-10-13",
   "texte": "La méthode de l'essai sur sm est rangée dans outils/ : rea_bridge.py (le pont qui garde REA ouvert sous WSL) et prescan.py (premier passage automatique d'un module : appels système, enveloppes nommées, boucle de service, fonctions manquées par Ghidra écrites en graines). Essayé sur hid : 19 secondes, 29 appels système, 250 puis 276 fonctions après un passage de graines. Règle posée par l'utilisateur ce jour : les identifiants sont en anglais (variables, fonctions, noms donnés en reverse), les textes restent en français ; les noms de fiches/sm.noms.tsv ont été renommés. La fiche de hid est en cours."
  },
  {
   "date": "2026-10-13",
   "texte": "Fiche de hid écrite par un sous-agent sur le modèle de sm (fiches/hid.md, fiches/hid.noms.tsv : 186 fonctions nommées sur 301). hid n'a pas une boucle unique : un fil par session (sept au plus), un fil de lecture des capteurs, et un seul aiguillage de 24 commandes à 0x102fc8 pour hid:USER, hid:SPVR, hid:QTM et hid:NFC, le type de session décidant des droits. La mémoire partagée fait 0x2B0 octets en cinq sections (boutons, tactile, accéléromètre, gyroscope, pad de débogage), les boutons y sont écrits toutes les 4 ms. Recoupé à la main : la table de 25 sauts à 0x102fec, le « mov r1, #0x2B0 » à 0x101500, et les huit commandes de hid:USER qui sont exactement celles de 3dbrew. prescan.py corrigé d'après ce passage : il décode la table de distances des fonctions d'initialisation (22 fonctions de plus dans hid), écarte un pointeur vers un « bl » isolé, signale un appel système hors de toute fonction, ne pose plus deux fois le même nom, et sait ranger le pseudo-code de toutes les fonctions (--dump). Repassé sur hid sans graine : 46 fonctions manquées trouvées en un passage au lieu de 25, toutes confirmées."
  },
  {
   "date": "2026-10-13",
   "texte": "Quatre fiches de plus, écrites en parallèle par quatre sous-agents, chacun avec son pont REA : loader (LoadProcess en 8 étapes ; sa décompression LZSS, récrite d'après l'assembleur, rend le code de Pokémon X et de sa mise à jour identique à celui de ctrtool, octet pour octet), pm (16 commandes, LaunchTitle en 12 étapes ; pour une application la commande répond tout de suite et le lancement se fait dans un autre fil), fs (136 commandes de fs:USER, 15 d'un fichier, 6 d'un dossier, 7 de fs:REG, les mêmes comptes que 3dbrew ; un chemin complet d'OpenFileDirectly à la requête 0x00090142 envoyée à Process9 ; 83 requêtes PxiFS), gsp (31 commandes de gsp::Gpu, 21 de gsp::Lcd, la mémoire partagée d'une page, les six commandes de la file graphique, six interruptions relayées). Les en-têtes que pm envoie à loader sont ceux que la fiche de loader lit côté réception : les deux fiches, écrites séparément, se confirment. Index dans fiches/README.md."
  },
  {
   "date": "2026-10-13",
   "texte": "prescan.py refait d'après ce que les quatre agents ont dû corriger à la main : il garde le genre des lignes du fichier de noms (les lignes « label », seule façon de nommer une fonction Thumb, étaient réécrites en « function »), ne nomme plus le point d'entrée svcExitProcess (le svc doit être tout près de l'entrée de la fonction), laisse de côté les cases des tables de saut d'un aiguillage (14 fausses graines dans pm), compte les svc sous condition (3 TerminateProcess dans pm), cherche les tables de distances aussi dans .text (celle de loader y est), attend que le pont écoute, et --dump sort aussi l'assembleur par l'objdump de devkitPro. Repassé sans graine sur pm, loader et gsp : 27, 23 et 50 fonctions manquées trouvées, toutes parmi celles que les agents avaient retenues, aucune fausse. Limite qui reste : le Thumb. fs est aux trois quarts en Thumb et REA n'y voit que 1 637 fonctions sur 1 995 ; sa fiche a demandé Ghidra lancé directement et de l'émulation (outils/REA.md, partie 4 bis)."
  },
  {
   "date": "2026-10-13",
   "texte": "Cinq fiches de plus, par cinq sous-agents en parallèle, ce qui en fait onze (index dans fiches/README.md) : pxi (les neuf services et leur canal, une requête de fs suivie jusqu'aux registres de la page 0x1EC63000 et retour), ns (les 93 commandes d'APT, le démarrage d'un jeu pas à pas, le bouton HOME), dsp (32 commandes, LoadComponent en 18 étapes : appliquée au dspaudio.cdc de Pokémon X, la disposition lue donne 6 segments aux SHA-256 justes, et la signature se vérifie avec la clé rangée dans le module), cfg (115 commandes sur quatre aiguillages, 65 blocs de configuration, GetConfigInfoBlk2 en 12 étapes), ptm (cinq aiguillages, la veille en 15 étapes). Recoupements entre fiches écrites séparément : ptm publie bien 0x104 et 0x105 à l'entrée en veille et au réveil, comme hid l'interprétait ; cfg donne 12 et 18 octets aux blocs d'étalonnage que hid lit ; les 12 requêtes de ns vers pm:app sont celles de la fiche de pm. nwm (le Wi-Fi) est laissé de côté : le plus gros des modules dumpés, le moins utile pour Pokémon X."
  },
  {
   "date": "2026-10-13",
   "texte": "Le Thumb est la limite de la méthode : fs, cfg (641 fonctions sur 686) et ptm (746 sur 813) sont presque entièrement en Thumb, REA ne sait donner en graine que de l'ARM, et prescan.py y annonçait « aucune fonction manquée » alors que les aiguillages eux-mêmes manquaient. Les trois agents ont lancé Ghidra directement sous WSL avec leurs scripts (local/analyse/<module>/ghidra/) et vérifié les aiguillages par émulation. prescan.py sonde maintenant la part de .text hors de toute fonction et avertit quand elle est forte sans fonction manquée (20 % dans ptm) ; l'enveloppe de SendSyncRequest n'est plus confondue avec une petite fonction d'envoi. Repassé sur sm, il y trouve sept fonctions d'initialisation de plus (117 fonctions, fiche mise à jour), dont celle qui prépare la table des services : 160 entrées de 20 octets, comme la fiche le disait. Écarts relevés avec la Carte des services du site, à corriger : en-têtes de cdc:HID et de cdc:DSP, une commande de mcu::HID mal nommée, deux en-têtes de mcu::RTC, services appelés manquants pour gsp (cfg:s) et dsp (ptm:s, cfg:s, ps:ps), huit commandes de cfg:i et deux de ptm:sysm absentes, quelques noms de commandes d'APT tronqués, pas de table pour les services de pxi."
  },
  {
   "date": "2026-10-13",
   "texte": "Ce que Pokémon X demande à la console, lu dans les chaînes du code de sa mise à jour : 34 services de la Carte y sont nommés. Huit des onze modules déjà en fiche en font partie (cfg, dsp, fs, gsp, hid, ns pour APT, ptm, sm). Treize modules sans fiche et pas encore dumpés sont nommés aussi : ro (ldr:ro), ac, boss, camera (cam:u, y2r:u), cecd, errdisp, friends, http, ir, mic, ndm, socket, ssl. Le plus important est ro : le code du jeu ne tient pas dans code.bin. Le romfs contient 134 modules chargés à la demande (fichiers .cro, 7,7 Mo en tout, dont DllField de 1,3 Mo et DllBattle de 1,0 Mo, plus .crr/static.crr), présents dans le jeu et dans sa mise à jour, que le module ro charge et relie par le service ldr:ro. Le code à lire fait donc près de 13 Mo et non 5,2, et un portage sur PC devra refaire ce chargeur. À dumper : le titre 0004013000003702 (ro)."
  },
  {
   "date": "2026-10-13",
   "texte": "La Carte des services est corrigée d'après les fiches, par un script de corrections (carte-des-services/corrections.js, rejouable, puisque le script d'origine n'est pas dans le dépôt). Défauts d'extraction corrigés : 208 noms de commandes tronqués, les neuf tables des services de pxi (218 lignes, sur six autres pages de 3dbrew), les descripteurs IPC de type 4 et 6. Divergences entre 3dbrew et le code de la console affichées côte à côte par un nouveau champ « vu dans le code », sans remplacer la valeur de 3dbrew : en-têtes de cdc:HID, cdc:DSP et mcu::RTC, usage de la commande 6 de mcu::HID, 29 liens module vers service que le code ouvre. La Carte passe de 3 569 à 4 053 commandes ; ses tests passent (29 139 vérifications). Les 83 requêtes PxiFS de la fiche de fs ont exactement les en-têtes de 3dbrew. Retour sur les fiches : 13 commandes notées « pas dans 3dbrew » y sont en fait, avec un en-tête incomplet ; les fiches de cfg, ptm et hid sont corrigées. Les quatre en-têtes de cfg:i complétés dans la Carte ne reposent que sur l'émulation de l'aiguillage (le code Thumb ne les contient pas en littéral)."
  },
  {
   "date": "2026-10-14",
   "texte": "La méthode Thumb est rangée dans outils/ : ghidra_direct.py <module> (Ghidra lancé directement sous WSL avec quatre scripts de outils/ghidra_scripts/ : graines Thumb, tables de switch imposées, noms posés après l'analyse, pseudo-code dans local/analyse/<module>/gh/) et emulate_dispatch.py <module> <adresse> (exécute un aiguillage pour chaque numéro de commande avec unicorn, installé dans local/pylib/). Preuve refaite : les tables émulées redonnent les 239 lignes des fiches de cfg (115), ptm (100) et hid (24), sans une différence ; ptm retrouve ses 813 fonctions, cfg 689 pour 686 dans la fiche (trois vraies fonctions que rien ne référence). Sur fs, 1 996 fonctions pour 1 995 : la liste d'origine comptait trois fausses fonctions nées de constantes prises pour des pointeurs Thumb et trois étiquettes de cas, et en manquait sept. Limites : une seule variante de l'aide de switch connue, des avertissements de table de saut restent dans le pseudo-code (les tables sûres viennent de l'émulation), l'émulation ne suit que le chemin « mémoire à zéro », peu essayé sur les modules ARM et pas sur loader."
  },
  {
   "date": "2026-10-14",
   "texte": "Inventaire de ce que Pokémon X peut demander à la console (fiches/pokemon-x-services.md et .tsv, statique) : le code de la mise à jour contient 408 instructions svc 0x32, toutes en ARM, dans 408 fonctions d'envoi distinctes, une commande par fonction. Il demande 23 noms de services par GetServiceHandle, plus les ports srv: et err:f. Par service : fs:USER 29 commandes (plus 10 sur un fichier ouvert et 4 sur un dossier), APT:U 29, gsp::Gpu 14, dsp::DSP 13, hid:USER 7, cfg:u 4, ldr:ro 4, ptm:u 1, srv: 5 ; le reste est du réseau et des accessoires (boss, cam, http, frd, y2r, nwm::UDS, soc, cecd, ac, ir, mic, ndm, ssl). Aucune fonction d'envoi n'est sans appelant. Démarrage : entry ouvre srv:, APT:U et ndm:u ; main ouvre cfg:u et ptm:u ; la fonction d'installation 0x107cbc ouvre fs:USER, hid:USER, gsp::Gpu, dsp::DSP, frd:u, boss:U puis ldr:ro (Initialize, LoadCRR) ; la boucle principale est à 0x1066ec. Correction de la note précédente : il y a 133 fichiers .cro et un static.crs, pas 134 .cro. Les .cro ne contiennent aucun appel système : tout passe par le code principal, auquel ils sont reliés par adresse (4 958 imports de code). Leur format est décrit, les empreintes SHA-256 de leurs en-têtes et de static.crr sont recalculées et retrouvées. Écart à trancher : GetExtDataBlockSize, 0x08540010 pour la Carte et la fiche de fs, 0x08540100 dans le jeu."
  },
  {
   "date": "2026-10-14",
   "texte": "Lecture détaillée des commandes que Pokémon X envoie, un « contrat » par service, lu des deux côtés (la fonction d'envoi du jeu, la fonction du module qui reçoit). Arrivés : fiches/contrat-gsp.md (14 commandes et les 6 de la file graphique lues des deux côtés ; la séquence jusqu'à la première image ; le jeu n'envoie jamais SetBufferSwap et annonce ses images par la mémoire partagée) et fiches/contrat-apt.md (27 commandes sur 29 lues des deux côtés ; le dialogue de démarrage minimal en neuf réponses, dont la police partagée, la plus lourde ; les numéros de notification de la fiche de ns confirmés par le code du jeu). À reporter : l'ordre du démarrage d'APT dans pokemon-x-services.md (Enable, NotifyToWait, GlanceParameter, ReceiveParameter, AppletUtility 7 puis 4) et la séquence du bouton HOME dans ns.md. Noms de fonctions proposés par les agents, gardés dans local/analyse/contrat-*/noms-proposes*.tsv en attendant la décision sur pokemon-x.noms.tsv. En cours au moment de la pause : contrat-fs.md, contrat-dsp.md, contrat-petits-services.md."
  },
  {
   "date": "2026-10-14",
   "texte": "Les trois derniers contrats sont arrivés pendant la pause, vérifiés sans rien enchaîner. contrat-dsp.md : 13 commandes lues des deux côtés et rejouées dans un émulateur ; le son démarre par LoadComponent de sound/dspaudio.cdc, un échange sur le tuyau 2 et la lecture de 15 adresses (la liste est telle quelle dans le composant, à la position 0x408), puis la boucle de son n'envoie plus aucune commande. contrat-petits-services.md : 17 commandes sur 22 lues des deux côtés ; le jeu demande 16 blocs de configuration (15 sur une console du commerce) et jamais le modèle ; il lit quatre sections de la mémoire de hid ; un gestionnaire de modules charge les .cro par leur nom, écran par écran, et c'est le jeu qui recopie .data et efface .bss après LoadExeCRO. contrat-fs.md : 43 commandes lues des deux côtés pour le message ; le jeu ouvre le romfs entier comme un seul fichier (OpenFileDirectly, archive 0x00000003, chemin binaire de 12 octets à zéro) et cherche les noms lui-même ; dans fs, cette archive est l'archive 0x2345678E de Process9, et fs lit lui-même l'en-tête IVFC et les niveaux. GetExtDataBlockSize : le module ne vérifie que le numéro 0x0854, les deux en-têtes passent. Noms de fonctions proposés par les cinq agents, à fusionner : local/analyse/contrat-*/noms-proposes*.tsv et la fin de chaque contrat."
  },
  {
   "date": "2026-10-14",
   "texte": "Le module ro est dumpé et rapatrié pendant la pause, sans rien relancer d'autre : local/dump/systeme/ro.cxi (titre 0004013000003702, 26 624 octets, déchiffré, SHA-256 d289f3e9…1a09eaac), extrait dans local/extrait/ro/ avec son code.elf en trois segments (45 056 octets de code). On y lit ldr:ro, CRO0, CRR0, fs:USER et ps:ps ; aucun pointeur impair vers le code, donc a priori de l'ARM, que la méthode ordinaire lit bien. Sa fiche et le chargeur de .cro restent à faire."
  },
  {
   "date": "2026-10-14",
   "texte": "Décisions de l'utilisateur à la reprise : le lot en cours ne sera commité et poussé qu'à la fin d'un gros jalon ; les 285 noms C++ tirés de static.crs restent dans fiches/pokemon-x.noms.tsv ; la correction du guichet de la Carte des services (app.js) est gardée ; ro est dumpé et récupéré (déjà extrait). Lancés ensemble : l'intégration des contrats dans les fiches, la fiche de ro, un chargeur de .cro sur PC, et les binaires qui ne sont pas des modules (kernel11, Process9, boot9 et boot11), par une méthode d'image brute."
  },
  {
   "date": "2026-10-14",
   "texte": "Les cinq contrats sont reportés dans les fiches (pokemon-x-services, ns, fs, cfg, hid, et aussi gsp, dsp, ptm, sm) ; 172 noms ajoutés au jeu (pokemon-x.noms.tsv, 920 lignes) et 11 à ns ; fiches/README.md présente l'inventaire et les contrats. Recoupé dans les octets : le repli de cfg sur le bit 0 de 0x1FF80014 (0x10ef6c), l'ordre des axes de la commande 22 de hid (0x103580-0x1035cc), les svc 0x18 du son, la comparaison à 0x2A07. La Carte des services reçoit 27 notes « vu dans le code » de plus (corrections.js, tests verts). emulate_dispatch.py corrigé : un en-tête lu dans une comparaison était jeté quand le refus passait par les mêmes adresses (Initialize de fs) ; les quatorze tables de cfg, ptm, hid et fs ne changent qu'aux deux lignes visées."
  },
  {
   "date": "2026-10-14",
   "texte": "Fiche de ro (fiches/ro.md, 123 fonctions nommées sur 180) : 9 commandes de ldr:ro, LoadExeCRO en 15 étapes, relocations 0, 2, 3, 10, 28, 29, 38, 42 en formules (comparées à l'exécution du code de ro), liaison dans les deux sens ; ro n'appelle ni OnLoad ni OnExit et ne touche ni .data ni .bss, ce que fait le jeu. Chargeur de .cro sur PC (outils/cro_loader.py) : 133 modules et static.crs liés sans import manquant, 536 empreintes justes, et un résultat identique octet pour octet à celui du code de ro exécuté sur cinq modules (code, .data, 22 mots du code principal). 3dbrew se trompe sur l'ordre des cases de la table des modules importés (début puis nombre)."
  },
  {
   "date": "2026-10-14",
   "texte": "Binaires qui ne sont pas des modules, lus comme images brutes : fiches/kernel11.md (noyau 2.58-0, table des 126 appels système à 0xFFF0230C, 20 classes d'objets, IPC et ControlMemory pas à pas, 293 appels des fiches recoupés sans écart), fiches/process9.md (section ARM9 déjà déchiffrée par GodMode9, kernel9 et ses 40 appels, 222 commandes PXI sur six services, le romfs : premier octet du chemin 0 pour le jeu de base, 5 pour la mise à jour), fiches/boot9-boot11.md (démarrage jusqu'au saut dans le FIRM, ce que le FIRM trouve en mémoire ; aucune clé ni octet de la moitié protégée). Outils : rea_bridge garde le journal de REA et répare les chemins réécrits par Git Bash, ApplyNames accepte un genre data, ghidra_direct reconnaît l'aide de switch de boot9. En cours : ranger dans outils/ la méthode image brute des trois agents."
  },
  {
   "date": "2026-10-14",
   "texte": "La méthode image brute est rangée : outils/ghidra_raw.py (cibles boot9, boot11, kernel11, kernel9, process9, arm9loader, réglées dans outils/raw_targets.toml), outils/firm.py (découpe native.firm, refait la carte de kernel11), outils/svc_check.py (13 sources recoupées avec le noyau). Relancées : kernel11, kernel9, Process9 et cfg redonnent les mêmes fonctions ; boot9 564 et boot11 227 au lieu de 572 et 229, parce que leur aide de switch est maintenant reconnue (les cas écartés n'étaient pas nommés)."
  },
  {
   "date": "2026-10-14",
   "texte": "La NAND est lue sur PC (outils/nand.py, avec pyctr dans local/pylib/ ; l'outil ne contient aucune clé, il les tire de boot9.bin et de la sauvegarde essentielle rangée par GodMode9 dans nand.bin). Les 8 modules dumpés par GodMode9 en ressortent identiques octet pour octet, et les deux sections ARM11 du NATIVE_FIRM de la CTRNAND sont celles de native.firm. Extraits : 59 modules (errdisp, ndm, ac, friends, boss, cecd, http, ssl, socket, ir, mic, camera, mcu...), 22 applets, 28 archives, dont la police partagée (local/extrait/police-partagee/cbf_std.bcfnt) et le fichier config de cfg. Inventaire : local/extrait/inventaire-nand.txt."
  },
  {
   "date": "2026-10-14",
   "texte": "Sauvegarde de Pokémon X rapatriée par ftpd (console à 172.30.134.53:5000 ce jour-là) dans local/dump/sd/, et déchiffrée sur PC par la nouvelle commande « nand.py sd » : 00000001.sav (1 Mo) est un DISA dont le seul fichier, main, fait 0x65600 octets ; ses 55 blocs ont tous leur CRC16-CCITT juste. Les données étendues (extdata 0000055d) ne contiennent que l'index VSXE et l'icône, l'index nommant aussi boss, btvideo, hgmail, pss_fr, reg, trhouse et user. Piège : le movable.sed de la sauvegarde essentielle de GodMode9 est plus ancien que celui de la CTRNAND et ne donne pas l'id0 de la carte ; seul celui de la CTRNAND convient. Rangé dans local/extrait/sd-0004000000055d00/."
  },
  {
   "date": "2026-10-14",
   "texte": "Premier démarrage de Pokémon X sur PC, au banc d'essai (banc/run.py) : le processeur est émulé par unicorn, échafaudage isolé dans cpu_unicorn.py ; noyau (41 appels système, fils, ordonnanceur, horloge propre), IPC et services (srv:, APT:U, fs:USER, gsp::Gpu, dsp::DSP, hid, cfg, ptm, ldr:ro par outils/cro_loader.py) sont écrits en Python d'après les fiches. En 25 s de console simulée (180 s de PC) : P1 à 0,8 ms, P2 à 1,0 ms, P3 à 86 ms (DllLangSelect), P4 à 102 ms ; puis DllTitle, DllBackGround, DllSequence, DllStartMenu à 3,3 s et DllField à 5,6 s, avec la vraie sauvegarde lue. 10 792 listes PICA envoyées et comptées, pas dessinées : aucune image encore. Seules erreurs : l'archive 0x2345678A (contenu d'un autre titre) et les données supplémentaires 0x6, que le jeu tolère. Aucun écart relevé avec les fiches. Sorties dans local/analyse/banc/ ; le banc est lancé par outils/tests.py."
  },
  {
   "date": "2026-10-14",
   "texte": "Première image : le banc dessine (banc/pica/, numpy) avec python banc/run.py --dessiner. Transferts vers l'écran, shaders de sommets, 14 formats de texture dont ETC1, les six étages TEV, profondeur, mélange, et y2r:u pour la vidéo du titre. On voit l'écran-titre (« APPUYEZ SUR START ») puis le menu « Continuer » avec la vraie sauvegarde (Kris, Palais Chaydeuvre, 1 badge, Pokédex 47, 2:31). Manquent l'éclairage par fragment (nécessaire au terrain), le brouillard, les mipmaps, le pochoir, les shaders de géométrie ; flottants en float32 au lieu de float24. Images dans local/analyse/banc/images/."
  },
  {
   "date": "2026-10-14",
   "texte": "La voie est choisie : recompilation statique de l'ARM11 vers C (recomp/, avec capstone), compilée par clang de llvm-mingw 20261006, portable, dans local/outils/llvm-mingw/. 23 877 des 23 882 fonctions de code.bin traduites entièrement (ARM 99,9994 %, Thumb 100 %, VFP compris) ; le jeu entier fait 61 Mo de C et une DLL de 77 Mo, dans local/recomp/ seulement. Comparées à unicorn sur des états tirés au hasard : 6 145 fonctions identiques (4 329 feuilles, 1 816 avec tout leur arbre d'appels), 0 divergence ; les autres ne sont pas encore exercées. 24 à 41 fois plus rapide qu'unicorn. Pas encore branché dans le banc."
  },
  {
   "date": "2026-10-16",
   "texte": "Moteur de mods (mods/) : un mod est un dossier de TOML qui ne contient aucun octet du jeu ; la construction lit le dump et produit, pour la console, l'arborescence LayeredFS de Luma3DS (luma/titles/0004000000055D00/romfs, un seul dossier pour le jeu et sa mise à jour, plus code.ips) et, pour le PC, une surcouche que banc/run.py --mod superpose au romfs (niveau 3 refabriqué, identique à l'original tant qu'on ne change rien). Lus et réécrits à l'identique sur tout le dump : 283 GARC, 5 808 fichiers de texte en 8 langues, la table des espèces (799 entrées), les attaques apprises, les évolutions, les attaques d'œuf et les attaques ; pk3DS a servi de guide, le code est le nôtre ; garc.py corrigé pour les sous-fichiers à emplacements creux. Mod d'exemple (Marisson de 56/61/65 à 80/95/70, Flamme au niveau 1, renommé) : sur le banc, le jeu lit bien les octets modifiés de a/2/1/8, a/2/1/4 et a/0/7/5. Pas encore essayé sur la console."
  },
  {
   "date": "2026-10-16",
   "texte": "Rendu PICA : l'aplat bleu du terrain est diagnostiqué, et le rendu n'y est pour rien. Un outil de rejeu (banc/pica/replay.py, PICA_ENREGISTRER) photographie la mémoire et les commandes de gsp à un instant donné et les rejoue en une seconde, au lieu de dix minutes de banc. Les listes de l'écran du haut après DllField (de 24 à 50 s) préparent les shaders mais ne contiennent aucun ordre de dessin : le bleu est le tampon vidé. Le moteur du terrain ne soumet pas de géométrie, et le fil 0x44 attend sur ArbitrateAddress(0x64bc7c) depuis 17,73 s, que le fil du son ne signale plus. L'éclairage par fragment est réécrit d'après le rendu logiciel d'Azahar et vérifié sur une sphère fabriquée ; brouillard, pochoir, opérations logiques et ciseaux qui excluent sont testés. Restent les mipmaps, les shaders de géométrie et les flottants de 24 bits."
  },
  {
   "date": "2026-10-16",
   "texte": "Six nouvelles fiches de modules système : camera (cam:u, cam:s, cam:c, y2r:u, cam:q ; tables de 68, 45 et 62 commandes recoupées par l'émulation contre le pseudo-code, SetReceiving jusqu'au DMA, registres de Y2R), mic, ir, ndm, ac et errdisp (le port err:f). Chacune dit, pour chaque commande que Pokémon X envoie, la fonction du module qui la reçoit et ce qu'un remplaçant de la console doit rendre. La table d'ac:u, écrite par un sous-agent, a été rejouée par emulate_dispatch.py : mêmes fonctions aux mêmes adresses. Restent nwm, friends, socket, http, ssl, boss et cecd ; la table de méthodes de ssl:C et les trois aiguillages de cecd sont repérés."
  },
  {
   "date": "2026-10-16",
   "texte": "Cinq fiches de modules réseau : ssl (32 commandes, trois tables de méthodes sous la session), cecd (cecd:u 22, cecd:s 38, cecd:ndm 8), socket (soc:U 35, soc:P 9), http (66 commandes sur trois étages) et friends (frd:u 54, frd:a 70, frd:n 4). Chaque table est recoupée par l'émulation de l'aiguillage et par 3dbrew ; celles de socket, http et friends, écrites par des sous-agents, ont été rejouées. Pour le portage, il faudra rendre vrais l'aléa de ssl, les fichiers de boîte de cecd, et les sockets et le DNS. La Carte des services reçoit les écarts des onze fiches du jour (corrections.js, 22 modules lus), dont la 24e commande de ndm:u. Restent nwm et boss."
  },
  {
   "date": "2026-10-16",
   "texte": "Terrain de Pokémon X : l'aplat bleu vient de la logique du jeu, pas du noyau du banc. Le fil 0x44 n'est que le décodeur AAC au repos, et le fil UDS (Player Search System) ne bloque rien : un nwm::UDS en erreur ne change rien. Le dessin 3D du haut dépend de la file des processus du jeu (objet 0x8c6702c, prédicat FUN_004783a8). La racine « Séquence » empilée par DllTitle se termine à 18,745 s, après le processus de chargement du terrain et le fondu ; la file se vide, et la fonction de dessin de DllField ne fait plus que ses appels QoS. Reste à trouver pourquoi DllField n'empile pas son processus de terrain."
  },
  {
   "date": "2026-10-16",
   "texte": "Le terrain de Pokémon X dessine sur le banc. Le jeu enchaîne ses listes PICA par les registres de saut du processeur de commandes (0x238-0x23D), que ni le comptage de gsp ni pica/gpu.py ne suivaient : d'où l'aplat bleu. Avec follow_jumps (banc/services/gsp.py, testé sur une liste fabriquée), l'écran du haut porte 14 DrawElements par image ; le rejeu dessine le ciel et deux lampadaires, et l'écran du bas le panneau du Système de Perfectionnement Virtuel, complet. Le diagnostic précédent était faux : la file des processus vide est l'état normal du terrain, et le fil 0x44 n'est que le décodeur AAC au repos. Le sol et les bâtiments manquent encore (shader de géométrie probable). Dix fonctions du gestionnaire de processus du jeu sont nommées."
  },
  {
   "date": "2026-10-16",
   "texte": "Fiches de nwm et de boss : tous les modules que Pokémon X appelle (22) ont maintenant la leur. nwm : sept aiguillages émulés (UDS 35 commandes, INF 16, SOC 13, SAP 44, CEC 30, EXT 9, TST 70), la machine d'états de l'UDS et ce qu'il faudrait pour la rendre vraie sur le réseau du PC ; le stub du banc rend à tort une poignée d'événement 0 à Initialize et un statut 0 à GetConnectionStatus. boss : boss:U 55 commandes, boss:P 143, boss:M 7, les 28 commandes du jeu avec leurs codes de résultat. Table de l'UDS rejouée : 35 commandes, mêmes fonctions. La clé AES de nwm n'est recopiée nulle part."
  },
  {
   "date": "2026-10-16",
   "texte": "Portage PC (portage/) : workspace Rust + wgpu, backend Vulkan forcé, sur la RTX 4070. Format de capture neutre .picacap (banc/pica/export_capture.py depuis les .pkl du rejeu) ; la crate pica traduit le PICA200 vers le GPU : shaders de sommets traduits en WGSL et mis en cache, combinateur TEV généré en WGSL selon l'état, les 14 formats de texture (bit pour bit identiques à formats.py), rastérisation par le GPU. Écran-titre et menu rejoués : à l'échelle native, écart moyen au rendu numpy de 0,003 à 0,046 sur 255 (un à deux niveaux au plus, sauf quelques points dans une capture), 14 à 34 ms par image contre 0,12 à 0,5 s ; et en 2×, 3× et 4× (1600×960 pour l'écran du haut). Crate overlay qui lit les mods par overlay.json format 1, fenêtre winit. 40 tests. Pas encore d'éclairage, de pochoir ni de shaders de géométrie, ni de noyau en Rust."
  },
  {
   "date": "2026-10-16",
   "texte": "Le terrain s'affiche en entier sur le banc : le palais Chaydeuvre, là où est la sauvegarde (façade, grille dorée, lampadaires, un PNJ et le joueur, avec les contours du jeu), 398 dessins et 29 652 triangles par image. Les chaînes de listes du terrain comptent jusqu'à 2 180 sauts dans une seule commande, et follow_jumps s'arrêtait à 64 : c'était la cause du ciel seul. Trois autres défauts de pica/ corrigés : le sens des faces, la table de brouillard mal lue (valeur en bits 13-23, différence signée en 0-12), et le tampon de profondeur relu comme texture jamais rendu à la mémoire. Les shaders de géométrie n'étaient pas en cause ; ils sont écrits et testés sur données fabriquées. L'écran-titre gagne aussi son fond en rayons. Le rejeu d'une image du terrain prend 8 s."
  },
  {
   "date": "2026-10-16",
   "texte": "Portage PC, partie 2 : le Rust rend le terrain du palais Chaydeuvre en entier sur la carte graphique, et en 4× (1600×960). Il suit la référence numpy complétée (sauts de liste, sens des faces, brouillard, découpe, texture projetée, profondeur relue), et fait désormais l'éclairage par fragment, le pochoir, les opérations logiques, les facteurs de mélange constants exacts et les boucles des shaders. Écart moyen au rendu numpy : 0,08 sur 255 au terrain (0,22 % de points de bord à plus de 8), 0,003 à 0,1 pour l'écran-titre et le menu. Une image du terrain : 9 ms à chaud en natif, 14 ms en 2×, 27 à 58 ms en 4× (numpy : 1,3 s). 44 tests."
  },
  {
   "date": "2026-10-16",
   "texte": "Services du banc alignés sur les fiches : banc/services/modules.py écrit treize services (nwm::UDS, boss, ssl:C, cecd:u, cam:u, mic:u, ir:USER, ndm:u, ac:u, frd:u, soc:U, http:C), chaque commande avec l'en-tête de réponse de sa fiche (441 commandes, test à l'appui), leurs états, de vraies poignées d'événement, l'aléa de ssl reproductible avec la graine, et les fichiers de cecd vrais. Au terrain, DllField est chargé à 17,65 s et dessine toujours ; le jeu ne tourne plus à vide sur UDS (10 StartScan en 25 s au lieu de 16). La Carte des services a reçu les écarts de nwm et de boss ; elle compte vingt-quatre modules lus."
  },
  {
   "date": "2026-10-16",
   "texte": "Passe de nommage rejouable (outils/name_pass.py) : cinq sources sûres croisées, chaque nom avec sa source et sa confiance. pokemon-x.noms.tsv passe de 930 à 1 239 noms : 21 enrobages d'appels système (vus aussi au banc), 21 fonctions de la bibliothèque standard reconnues en les exécutant sur des entrées fabriquées, 267 destructeurs de classes C++ lus dans les typeinfo et les tables virtuelles (schéma confirmé sur 40 tables que static.crs nomme). 194 fonctions des 133 modules .cro sont nommées (fiches/cro/). Les imports des .cro sont tous anonymes et ne donnent aucun nom. 75 noms de confiance moyenne restent en proposition. Ghidra repose les 1 239 noms sans aucune fonction manquante."
  },
  {
   "date": "2026-10-16",
   "texte": "Portage PC : le rendu tient 60 images par seconde au terrain. Les dessins vers les mêmes tampons s'enchaînent dans une seule passe, constantes, sommets et indices vont dans de grands tampons, sommets décodés et textures sont gardés par horodatage des pages, et le GPU n'est relu que quand une commande lit la mémoire. Une couleur, une profondeur ou une copie relues comme texture restent sur le GPU, à la définition de l'échelle. Terrain du palais : 27 à 80 ms par image avant ; maintenant 7 ms en natif, 9 ms en 2× (vérifié : 8,8 ms) et 13,5 ms en 4×, images et mémoire comprises. Écart à la référence numpy inchangé ; images et mémoire identiques octet pour octet au chemin d'avant."
  },
  {
   "date": "2026-10-16",
   "texte": "Le processeur natif est branché dans le banc : python banc/run.py --cpu hybride fait tourner Pokémon X sur son code ARM11 recompilé en C (une fibre par fil de la console, unicorn pour les .cro) jusqu'à DllField avec la vraie sauvegarde, 24 s de banc sans faute, mêmes paliers qu'unicorn. Le mode --cpu verifier (chaque tranche native rejouée par unicorn) ne trouve plus aucune divergence sur 1,2 s (5 677 tranches). Il a fait trouver trois familles de bugs du recompilateur, corrigés avec des tests sur du code fabriqué : adresses de retour fixées à la main (add lr, pc), retours non locaux (pop {pc} qui dépile l'épilogue de l'appelant), retours vers une adresse qu'aucun cadre C n'attend plus. Pas encore plus rapide (587 s contre 504 s pour 24 s de banc, dont 4 s de natif) : le temps du jeu est dans les .cro, qu'unicorn exécute encore. Compilation incrémentale du jeu recompilé : 15 à 60 s après un ajout."
  },
  {
   "date": "2026-10-16",
   "texte": "Fiches des huit modules proches du matériel : gpio, pdn, i2c, spi, mcu, codec, csnd et ps (1 520 fonctions, 894 nommées, 273 commandes). Chaque table de commandes est recoupée par l'émulation de l'aiguillage, le pseudo-code et 3dbrew ; celle d'i2c a été rejouée (21 commandes). mcu : 161 commandes avec les registres du microcontrôleur, la chaîne bit d'interruption vers notification, la réécriture du micrologiciel. codec : tactile, micro, prise casque. ps : relais vers Process9, aucune clé dans le module ni dans la fiche. 3dbrew appelle gyroscope ce que mcu::HID 6 lit comme accéléromètre."
  },
  {
   "date": "2026-10-16",
   "texte": "Carte des services : les huit fiches matérielles passées dans corrections.js, soit trente-deux modules lus, avec les rôles lus dans le code, les liens d'appel manquants et deux lignes de 3dbrew que la Carte avait perdues (cdc:CHK). Nouvelle fiche safe.md : les 23 variantes « safe » de la NAND comparées à leur module normal, fonction par fonction, exheader et aiguillages rejoués. Quatre sont identiques à 100 % (codec, spi, pdn, friends) et huit à 97-99 %. Les écarts de commandes sont dans cfg, http, hid, ir:rst, am et ns. nim-safe est un autre code (3 % de commun)."
  },
  {
   "date": "2026-10-16",
   "texte": "Les neuf derniers modules système ont leur fiche (am, news, act, dlp, mp, nfc, mvd, nim, qtm) : tous les modules système de la NAND sont maintenant lus. 950 noms posés dans Ghidra, tables de commandes recoupées par l'émulation des aiguillages et par la Carte. am n'est qu'un relais vers pxi:am9 : 88 commandes recoupées avec Process9, aucune divergence. act, news et nfc ont des commandes que la Carte ne connaît pas ; nim est une fiche courte. Aucune clé, aucun secret ni identifiant dans les fiches : ceux d'act, dlp et nfc sont décrits par leur adresse."
  },
  {
   "date": "2026-10-16",
   "texte": "Les 133 modules .cro sont recompilés en C relogeable (recomp/cro_recomp.py) : 37 854 fonctions, aucune instruction non traduite, et la base du module est lue à l'exécution. L'adresse de chargement dépend en effet de l'ordre des chargements et, sur la console, de l'allocateur du jeu. Le même module traduit à deux bases donne le même C (0 écart sur 133). Le banc branche un module au chargement s'il a exactement le code compilé (empreinte SHA-1), et le débranche au déchargement. Un bug du recompilateur corrigé (VCVT avec un registre simple impair). Sur 24 s de banc, l'hybride passe de 743 s à environ 330 s de PC. Le reste vient de trous de code.bin que le natif découvre, à résorber par tours (banc, trous.txt, régénération)."
  },
  {
   "date": "2026-10-16",
   "texte": "Portage Rust : le runtime. Le noyau de la console (mémoire, objets, ordonnanceur et horloge du banc, 41 appels système, IPC), les services du démarrage (srv, APT, fs avec les mods par overlay, gsp, dsp, hid, cfg, ptm, ldr:ro et les treize modules simplifiés), le chargeur de .cro et le processeur recompilé (jeu-hote.dll, une fibre par fil) sont réécrits en Rust. Sur 3 s de banc, avec les .cro recompilés branchés, le journal Rust est identique ligne à ligne, heure comprise, à celui de python banc/run.py --cpu natif : 10 313 lignes, paliers P1 à P5, en 9,3 s de PC. Le chargeur de .cro en Rust donne les mêmes rapports que cro_loader.py sur les 133 modules. Reste à brancher le rendu pica sur les transferts de gsp pour voir le jeu en direct."
  },
  {
   "date": "2026-10-17",
   "texte": "Reprise sur le PC fixe et le jeu en direct dans une fenêtre. local/ remonté depuis les zips (19 966 fichiers vérifiés), Ghidra 12.1.4, JDK 21, ctrtool, makerom, WSL Ubuntu avec REA 6.5.0 et /opt/ghidra réinstallés ; REFERENCES.md recense les projets voisins (3dsrecomp, PokeXYZ-RDComp : même SHA-256 de code.bin v1.5). Le runtime Rust pilote pica en direct (gsp::GpuBackend, mémoire du noyau partagée sans copie) : runtime run --dessiner donne les images du banc (bas identiques, haut à 0,12/255 près, le biais d'arrondi déjà vu au rejeu), et portage play affiche le jeu en temps réel (30 images/s, clavier vers hid), image de la fenêtre identique octet pour octet aux PNG. recomp.py trouve les prologues que Ghidra manque (« str lr, [sp, #-4]! » de l'assembleur écrit à la main, entrées « mov r5 ; mov r6 ; push » des décodeurs de bits) : 26 183 fonctions ; et reprend une adresse de retour posée par une autre fonction (ldr lr littéral, 0x122f04 -> 0x132d50, la sortie des fils). Avec --appuis 14:START,16:A,18:A, le runtime Rust va sans faute jusqu'à 60 s et au terrain (palais Chaydeuvre), 30 s de jeu en 30,1 s de PC dessin compris ; journal identique au banc natif sur 20 s (56 014 lignes)."
  },
  {
   "date": "2026-10-17",
   "texte": "Le portage natif joue : avec un scénario de 180 s (Start, Continuer, marcher vers le palais, A, ressortir), le runtime Rust va sans faute du menu au palais Chaydeuvre, entre dans la salle de la statue (dialogue, PNJ) et ressort, en 91 s de PC dessin compris. Un tour du cycle des trous (banc hybride sur le même scénario : 57 adresses, dont 0x3bf924 qu'un .cro appelle par un pointeur que l'analyse statique ne voit pas) : 26 241 fonctions. Carte des services : les écarts des neuf dernières fiches (am, news, act, dlp, mp, nfc, mvd, nim, qtm) sont reportés, 145 corrections, 11 commandes ajoutées ; fiche news corrigée."
  }
 ],
 "dump": {
  "present": true,
  "fichiers": [
   "pokemon-x.cxi",
   "pokemon-x_maj.cxi"
  ],
  "titre": "0004000000055D00",
  "produit": "CTR-P-EKJA",
  "dechiffre": true,
  "exefs": 3164160,
  "romfs": 1797873664
 },
 "extrait": {
  "present": true,
  "code_octets": 5156864
 }
};
