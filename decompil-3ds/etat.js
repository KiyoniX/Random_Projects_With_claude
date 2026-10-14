// Écrit par outils/verifier.py. Éditer etat.json, pas ce fichier.
window.ETAT = {
 "console": "New Nintendo 3DS XL, Luma3DS installée (boot9strap)",
 "objectif": "Faire tourner Pokémon X nativement sur PC, sans émulateur.",
 "ouverture": "2026-10-13",
 "mise_a_jour": "2026-10-14",
 "prochaine_action": "Le jeu tourne jusqu'au terrain au banc d'essai, sans image. Suite au choix : exécuter les listes PICA et les transferts vers l'écran pour voir la première image (banc/README.md, « L'image ») ; ou commencer la recompilation de l'ARM pour remplacer unicorn ; ou commit du jalon.",
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
     "fait": true
    },
    {
     "t": "Banc d'essai (banc/) : le code du jeu sous unicorn, la couche système en Python d'après les contrats, jusqu'au terrain",
     "fait": true
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
   "role": "L'outil principal du parcours : un serveur MCP qui donne à Claude Code la main sur Ghidra (pseudo-code, chaînes, références, symboles) et exige les preuves de chaque conclusion. On lui demande, puis on vérifie dans Ghidra. La version Windows n'ouvre que des exécutables PE x86 : pour notre ARM, c'est l'entrée « rea-wsl » (REA et Ghidra dans Ubuntu sous WSL, ARM v6 imposé), branchée le 2026-10-13. Voir outils/REA.md.",
   "ou": "Paquet npm rea-agents 6.4.0 : « rea » (Windows) et « rea-wsl » (Ubuntu) dans ~/.claude.json",
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
   "present": true,
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
