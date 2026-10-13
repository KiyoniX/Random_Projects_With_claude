// Écrit par outils/verifier.py. Éditer etat.json, pas ce fichier.
window.ETAT = {
 "console": "New Nintendo 3DS XL, Luma3DS installée (boot9strap)",
 "objectif": "Faire tourner Pokémon X nativement sur PC, sans émulateur.",
 "ouverture": "2026-10-13",
 "mise_a_jour": "2026-10-13",
 "prochaine_action": "Dumper le Pokémon X installé (copie numérique) avec le gestionnaire de titres de GodMode9, en .cxi, et le poser dans local/dump/.",
 "fonctions": {
  "total": null,
  "identifiees": 0,
  "nommees": 0,
  "reimplementees": 0
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
     "fait": false
    },
    {
     "t": "Dumper aussi la mise à jour du jeu si elle est installée (titre 0004000E…), c'est elle qui porte le code qui tourne",
     "fait": false
    },
    {
     "t": "Poser le fichier dans local/dump/ et lancer outils/inspecter.py",
     "fait": false
    },
    {
     "t": "Extraire exefs et romfs avec outils/extraire.py",
     "fait": false
    },
    {
     "t": "Noter l'empreinte SHA-256 du dump dans le journal",
     "fait": false
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
     "fait": false
    },
    {
     "t": "Brancher REA à Claude Code (paquet rea-agents, enregistrement par « rea setup »)",
     "fait": true
    },
    {
     "t": "Installer WSL avec Ubuntu, et y brancher REA et un Ghidra Linux : sous Windows, REA n'ouvre que des exécutables PE",
     "fait": false
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
     "fait": false
    },
    {
     "t": "Décoder les textes du jeu (décodeur écrit, à valider sur le romfs)",
     "fait": false
    },
    {
     "t": "Lire les tables des Pokémon (stats, types, apprentissages)",
     "fait": false
    },
    {
     "t": "Afficher un modèle BCH et une carte",
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
     "fait": false
    },
    {
     "t": "Choisir la voie : recompilation statique de l'ARM11 ou décompilation",
     "fait": false
    },
    {
     "t": "Fichiers et manette",
     "fait": false
    },
    {
     "t": "Le GPU PICA200 vers OpenGL",
     "fait": false
    },
    {
     "t": "Le son",
     "fait": false
    },
    {
     "t": "Premier écran du jeu affiché sur PC",
     "fait": false
    }
   ]
  }
 ],
 "outils": [
  {
   "id": "rea",
   "nom": "REA (Reverse Engineer Anything)",
   "role": "L'outil principal du parcours : un serveur MCP qui donne à Claude Code la main sur Ghidra (pseudo-code, chaînes, références, symboles) et exige les preuves de chaque conclusion. On lui demande, puis on vérifie dans Ghidra. Limite vue le 2026-10-13 : la version Windows n'ouvre que des exécutables PE x86, pas notre ARM ; il faut le faire tourner sous WSL. Voir outils/REA.md.",
   "ou": "Paquet npm rea-agents 6.4.0, enregistré dans ~/.claude.json",
   "lieu": "pc",
   "present": true,
   "lien": "https://github.com/morluto/rea",
   "note": "Paquet installé, déclaration MCP trouvée, Node 22+ présent"
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
   "ou": "Sur la console (Start au démarrage)",
   "lieu": "console",
   "present": null,
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
   "nom": "devkitPro, libctru, GDB",
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
  }
 ],
 "dump": {
  "present": false,
  "fichiers": []
 },
 "extrait": {
  "present": false,
  "code_octets": 0
 }
};
