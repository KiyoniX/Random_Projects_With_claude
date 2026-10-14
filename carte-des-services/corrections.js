/* Carte des services : corrections appliquées à donnees.js après sa production.

   donnees.js a été tiré de 3dbrew par un script qui n'est pas dans le dépôt. Depuis, onze modules système ont été
   lus dans le code de la console (../decompil-3ds/fiches/), et ces lectures ont relevé des écarts. Ce script les
   traite, pour qu'une régénération de donnees.js ne perde rien : il suffit de le relancer.

   Usage :
     node corrections.js           applique les corrections et récrit donnees.js s'il change
     node corrections.js --check   n'écrit rien ; sort en erreur si donnees.js n'est pas à jour
     node corrections.js --list    affiche chaque correction appliquée

   Trois sortes de corrections, qu'il ne faut pas confondre :
   1. Défaut d'extraction : la Carte avait mal recopié 3dbrew (nom tronqué, tableau sauté). La donnée est corrigée
      d'après 3dbrew, relu en wikitexte brut le 13 octobre 2026.
   2. Divergence entre 3dbrew et le code de la console : la valeur de 3dbrew reste en place, et une note « seen »
      dit ce que le code fait, dans quel module, avec un renvoi à la fiche. Le lecteur voit les deux.
   3. 3dbrew incomplet, complété par le code : l'entrée porte une note « seen » marquée byCode.

   Une note « seen » : { module, text, h?, byCode? }. module est un des modules de codeSource.modules ; h est
   l'en-tête que le code écrit quand il n'est pas celui de 3dbrew ; byCode dit que l'en-tête de l'entrée vient du code.
   Chaque nombre cité dans un texte vient de la fiche du module, à la ligne donnée en commentaire. */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'donnees.js');
const PXI_FILE = path.join(__dirname, 'corrections-pxi.json');
const MARKER = 'const DONNEES = ';
const HEADER_NOTE = '   Corrigé ensuite par corrections.js (node corrections.js) : ne pas le modifier à la main. */';
const UNNAMED = 'Inconnue';

/* ------------------------------------------------------------ d'où viennent les notes « seen » */
const CODE_SOURCE = {
  fiches: '../decompil-3ds/fiches/',
  modules: ['cfg', 'dsp', 'fs', 'gsp', 'hid', 'loader', 'ns', 'pm', 'ptm', 'pxi', 'sm'],
  note: 'Onze modules système lus dans le code dumpé d\'une New 3DS, une fiche par module. Ce que le code fait sur cette console peut différer de ce que 3dbrew décrit.'
};
const SOURCE_NOTE = ' Corrections du 13 octobre 2026 (corrections.js) : pages relues directement sur 3dbrew, et notes « vu dans le code » tirées des fiches de decompil-3ds.';

/* ------------------------------------------------------------ 1. noms tronqués
   Quand 3dbrew décrit une commande par une phrase ou par une signature au lieu d'un nom lié, l'extraction avait
   pris le premier mot pour nom : « u8 » pour « u8 GetStepCount », « Stubbed » pour « Stubbed, always returns 0 ».
   Le texte entier est resté dans la note de la commande ; le nom en est retiré par deux règles. */
const TYPE_WORDS = ['u8', 'u16', 'u32', 'u64', 's8', 's16', 's32', 'bool', 'void', 'Handle'];
// « u8 GetHour », « Handle GetPowerEventHandle. … », « u8 low, u8 high GetVolumeSliderBounds » : le nom suit le type.
const SIGNATURE = new RegExp('^(?:(?:' + TYPE_WORDS.join('|') + ')\\s+(?:[a-z]+,?\\s+)?)+([A-Z][A-Za-z0-9_]*)');
// Premiers mots de phrases relevés dans la Carte : la commande n'a pas de nom sur 3dbrew.
const PROSE_WORDS = ['Calls', 'Closes', 'Does', 'Gamecard', 'Identical', 'Interface', 'Modifies', 'Powers', 'Related',
  'Returns', 'Same', 'Sets', 'Stubbed', 'Takes', 'This', 'Unknown', 'Used', 'Waits', 'When', 'Writes'];

/* Les en-têtes incomplets (« partiels ») n'ont pas gardé le texte de 3dbrew : il est redonné ici, relu sur la page. */
const PARTIAL_TEXTS = [
  { services: ['ptm:sysm', 'ptm:s'], id: '0x0816', text: 'Abstraction for mcu::RTC::GetSystemClock' },   // PTM_Services
  { services: ['ptm:sysm', 'ptm:s'], id: '0x0817', text: 'Abstraction for mcu::RTC::SetSystemClock' },
  { services: ['am:pipe'], id: '0x0001', text: 'Stubbed. After validating the translate-paramater headers, this just returns error 0xE0C046F8.' },   // Application_Manager_Services
  { services: ['nim:s'], id: '0x0009', text: 'Returns 0xE0C0D3F4, not implemented.' },   // NIM_Services
  { services: ['nim:s'], id: '0x0036', text: 'Returns 0xE0C0D3F4, not implemented.' },
  { services: ['boss:P'], id: '0x0421', text: 'Stubbed' },   // BOSS_Services
  { services: ['boss:P'], id: '0x0423', text: 'Stubbed' },
  { services: ['boss:P'], id: '0x0448', text: 'Stubbed' },
  { services: ['news:s'], id: '0x0002', text: 'Stubbed, only returns 0.' },   // News_Services
  { services: ['news:s'], id: '0x0003', text: 'Stubbed, only returns 0.' },
  { services: ['SPI::NOR', 'SPI::CD2', 'SPI::CS2', 'SPI::CS3', 'SPI::DEF'], id: '0x0002', text: 'Stubbed, only returns zero.' },   // SPI_Services
  { services: ['mcu::NWM'], id: '0x0003', text: 'Sets GPIO 0x20 high/low?' },   // MCU_Services
  { services: ['mcu::NWM'], id: '0x0004', text: 'Gets GPIO 0x20 high/low?' }
];
const PARTIAL_PROSE_WORDS = PROSE_WORDS.concat(['Abstraction', 'Gets']);

/* ------------------------------------------------------------ 2. divergences entre 3dbrew et le code
   h3dbrew est l'en-tête de la Carte, celui de 3dbrew : il reste en place. */
const HEADER_NOTES = [
  // hid.md, lignes 233 et 258. La page 3dbrew Cdc:HID:GetData donne « Header code [0x00010000] ».
  { service: 'cdc:HID', h3dbrew: '0x00010042', seen: { module: 'hid', h: '0x00010000',
    text: 'hid écrit cet en-tête pour lire le tactile et le pad circulaire (CDCHID_GetData, 0x106a74). Sur 3dbrew, la page de la commande donne elle aussi 0x00010000 ; seul le tableau des services donne 0x00010042.' } },
  // hid.md, ligne 234.
  { service: 'cdc:HID', h3dbrew: '0x00020042', seen: { module: 'hid', h: '0x00020000',
    text: 'hid écrit cet en-tête au début de la lecture (CDCHID_Initialize, 0x104ec8).' } },
  // dsp.md, lignes 436 et 459. Sur 3dbrew, ReadMultiEx_SPI2 de dsp::DSP (0x001D00C0) est « Wrapper for cdc:DSP cmd 4 ».
  { service: 'cdc:DSP', h3dbrew: '0x00040042', seen: { module: 'dsp', h: '0x000400C0',
    text: 'dsp écrit cet en-tête quand il relaie ReadMultiEx_SPI2 de dsp::DSP, 0x40 octets au plus (CDCDSP_cmd0004, 0x106c18).' } },
  // dsp.md, ligne 438.
  { service: 'cdc:DSP', h3dbrew: '0x00060080', seen: { module: 'dsp', h: '0x00060000',
    text: 'dsp écrit cet en-tête quand il relaie GetHeadphoneStatus de dsp::DSP (CDCDSP_cmd0006, 0x106d5c).' } },
  // ptm.md, lignes 343 et 410.
  { service: 'mcu::RTC', h3dbrew: '0x00210080', seen: { module: 'ptm', h: '0x00210000',
    text: 'ptm écrit cet en-tête pour lire le nombre de pas (MCURTC_GetStepCount, 0x103ea0).' } },
  // ptm.md, lignes 354 et 409.
  { service: 'mcu::RTC', h3dbrew: '0x002E0000', seen: { module: 'ptm', h: '0x002E0040',
    text: 'ptm écrit cet en-tête, avec un octet : 2 à l\'endormissement, 0 au réveil (MCURTC_SetPowerModeIndicatorState, 0x1023f0).' } },
  // hid.md, lignes 237, 252 et 259. Le nom reste celui de 3dbrew.
  { service: 'mcu::HID', h3dbrew: '0x00060000', seen: { module: 'hid',
    text: 'hid range le résultat de cette commande dans la section de l\'accéléromètre de sa mémoire partagée (MCUHID_cmd0006, 0x10693c). Il lit le gyroscope par i2c::HID (I2CHID_ReadRegisterBuffer8, 0x108090). Le nom ReadGyroscopeValues est celui de 3dbrew.' } },
  // ptm.md, ligne 384 ; pxi.md, lignes 182 et 191. Le code confirme 3dbrew.
  { service: 'pxi:mc', h3dbrew: '0x00050040', seen: { module: 'ptm',
    text: 'ptm envoie cette requête avec 1 avant de dormir et 0 après (PXIMC_cmd0005, 0x107ce2).' } },

  // Les corrections du 14 octobre 2026 : relevées par les contrats (chaque commande que Pokémon X envoie, lue côté
  // jeu et côté module) et reportées dans les fiches.
  // fs.md, ligne 238 ; contrat-fs.md, partie 6.
  { service: 'fs:USER', h3dbrew: '0x08540010', seen: { module: 'fs', h: '0x08540100',
    text: 'Pokémon X écrit 0x08540100 (quatre mots ordinaires : la structure ExtSaveDataInfo et un mot nul), comme DeleteExtSaveData (0x08520100) qui porte la même structure. L\'aiguillage de fs ne compare que le numéro : les deux en-têtes mènent à fsuser_GetExtDataBlockSize (0x114a40), qui répond 0x08540180. 0x08540010 semble une coquille de 3dbrew.' } },
  // gsp.md, ligne 148 ; contrat-gsp.md, lignes 720 et 721.
  { service: 'gsp::Gpu', h3dbrew: '0x00010082', seen: { module: 'gsp',
    text: 'gsp ne lit pas le mot 2 (la taille) : il la prend dans le descripteur du mot 3. Pokémon X met la même valeur aux deux endroits (write_hw_regs, 0x107540).' } },
  { service: 'gsp::Gpu', h3dbrew: '0x00080082', seen: { module: 'gsp',
    text: 'La zone peut être dans le tas linéaire (0x14000000 à 0x1C000000, ou 0x30000000 à 0x40000000) ou dans la mémoire supplémentaire de la New 3DS (0x1E800000 à 0x1EC00000), sinon 0xE0E02BF5 (gspgpu_FlushDataCache, 0x1092f4).' } },
  // dsp.md, lignes 327 et 601 ; contrat-dsp.md, désaccords.
  { service: 'dsp::DSP', h3dbrew: '0x000D0082', seen: { module: 'dsp',
    text: 'Sur le canal 2, le mot d\'état (0 démarre, 1 arrête, 2 redémarre après une veille, 3 arrête pour une veille) est aux octets 0 et 1, pas à la position 2 que donne 3dbrew : Pokémon X et le module s\'accordent là-dessus.' } },
  // ptm.md, ligne 139 ; contrat-petits-services.md, partie 4.
  { service: 'ptm:u', h3dbrew: '0x000B00C2', seen: { module: 'ptm',
    text: 'Le mot 1 n\'est pas lu : le nombre d\'heures vient de la taille du tampon, divisée par 2 (ptm_GetStepHistory, 0x104c3c). Chaque valeur est plafonnée à 18 000.' } },
  // hid.md, lignes 119 et 123 ; contrat-petits-services.md. Les trois services partagent l'aiguillage.
  ...['hid:USER', 'hid:SPVR', 'hid:QTM'].map(service => ({ service, h3dbrew: '0x00160000', seen: { module: 'hid',
    text: 'La réponse ne garde pas l\'ordre de l\'étalonnage enregistré : en numéros des neuf nombres gardés, 0, 1, 2, −6, 7, 8, 3, 4, 5 (le zéro du troisième axe changé de signe, le deuxième et le troisième axes échangés). Rangés par l\'aiguillage de 0x103580 à 0x1035cc.' } })),
  ...['APT:U', 'APT:A', 'APT:S'].flatMap(service => [
    // ns.md, lignes 201 à 205 ; contrat-apt.md, partie 5.
    { service, h3dbrew: '0x00010040', seen: { module: 'ns',
      text: 'Le mot 3 de la réponse vaut toujours 0 (apt_GetLockHandle, 0x1069e8). L\'état du bouton d\'alimentation et la fermeture demandée arrivent par les notifications 8, 7 et 11.' } },
    { service, h3dbrew: '0x000C0104', seen: { module: 'ns',
      text: 'La taille est prise dans le descripteur du mot 7 ; le mot 4 n\'est pas lu. La commande 0x10 n\'est pas transmise : ns dépose aussitôt pour l\'expéditeur un paramètre de commande 3.' } },
    { service, h3dbrew: '0x000D0080', seen: { module: 'ns',
      text: 'Le mot 7 de la réponse porte la taille demandée, plafonnée à 0x1000 ; la taille copiée est au mot 4.' } },
    { service, h3dbrew: '0x000E0080', seen: { module: 'ns',
      text: 'Le mot 7 de la réponse porte la taille demandée, plafonnée à 0x1000 ; la taille copiée est au mot 4.' } },
    { service, h3dbrew: '0x003B0040', seen: { module: 'ns',
      text: 'Le paramètre n\'est pas lu (apt_CancelLibraryApplet, 0x107f00).' } },
    { service, h3dbrew: '0x00420080', seen: { module: 'ns',
      text: 'Les deux mots sont des masques, pas une durée : le mot 1 est masqué par 0x40000002, le mot 2 par 0x64, puis la demande part à ptm:sysm (apt_SleepSystem, 0x1066f8).' } }
  ])
];

/* ------------------------------------------------------------ 3. en-têtes incomplets sur 3dbrew, complétés par le code
   L'entrée quitte la liste des en-têtes incomplets et entre dans le tableau, marquée byCode. */
const URL_CFGI = 'https://www.3dbrew.org/wiki/Config_Services#Config_service_"cfg:i"';
const URL_SPI = 'https://www.3dbrew.org/wiki/SPI_Services#SPI_Service_Commands';
const URL_PXIMC = 'https://www.3dbrew.org/wiki/Mode_Control_Services_PXI#"pxi:mc"_service';
const COMPLETED_HEADERS = [
  // cfg.md, lignes 151, 152, 155 et 157 : colonne « En-tête vérifié » à « entier ». La valeur exigée a été relevée
  // en exécutant l'aiguillage de cfg:i (decompil-3ds/local/analyse/cfg/dispatch_raw.txt, non versionné).
  { service: 'cfg:i', id: '0x081A', h: '0x081A0042', n: UNNAMED, url: URL_CFGI, seen: { module: 'cfg',
    text: '3dbrew ne donne que 0x081A.... Le code n\'accepte que l\'en-tête entier 0x081A0042 et répond 0x081A0042 : la commande rend la valeur recalculée du bloc 0x00060000, sans l\'écrire (build_block_00060000, 0x104d7c).' } },
  { service: 'cfg:i', id: '0x081B', h: '0x081B0042', n: UNNAMED, url: URL_CFGI, seen: { module: 'cfg',
    text: '3dbrew ne donne que 0x081B.... Le code n\'accepte que l\'en-tête entier 0x081B0042 et répond 0x081B0042 : la commande rend la valeur recalculée du bloc 0x00040001, sans l\'écrire (build_block_00040001, 0x104c74).' } },
  { service: 'cfg:i', id: '0x081E', h: '0x081E0042', n: UNNAMED, url: URL_CFGI, seen: { module: 'cfg',
    text: '3dbrew ne donne que 0x081E.... Le code n\'accepte que l\'en-tête entier 0x081E0042 et répond 0x081E0042 : la commande rend la valeur recalculée du bloc 0x00040004, dans un tampon de 0x1C octets (build_block_00040004, 0x1052b0).' } },
  { service: 'cfg:i', id: '0x0820', h: '0x08200042', n: UNNAMED, url: URL_CFGI, seen: { module: 'cfg',
    text: '3dbrew ne donne que 0x0820.... Le code n\'accepte que l\'en-tête entier 0x08200042 et répond 0x08200042 : la commande rend la valeur recalculée du bloc 0x00180001, dans un tampon de 0x18 octets (build_block_00180001, 0x104120).' } },
  // cfg.md, lignes 418, 419, 421 et 429 : ce que cfg envoie à SPI::NOR. Les noms et les notes sont ceux de 3dbrew.
  { service: 'SPI::NOR', id: '0x0001', h: '0x00010080', n: 'SetDeviceState', note: 'SetDeviceState(u8 deviceid, u8 state)', url: URL_SPI, seen: { module: 'cfg',
    text: '3dbrew ne donne que 0x0001.... cfg envoie 0x00010080 à l\'ouverture de cfg:nor (SPI_cmd0001, 0x108c86).' } },
  { service: 'SPI::NOR', id: '0x0002', h: '0x00020040', n: UNNAMED, note: 'Stubbed, only returns zero.', url: URL_SPI, seen: { module: 'cfg',
    text: '3dbrew ne donne que 0x0002.... cfg envoie 0x00020040 à la fermeture de cfg:nor (SPI_cmd0002, 0x108e14).' } },
  { service: 'SPI::NOR', id: '0x0005', h: '0x000500C0', n: 'WriteDevice', note: 'WriteDevice(u8 deviceid, ...)', url: URL_SPI, seen: { module: 'cfg',
    text: '3dbrew ne donne que 0x0005.... cfg envoie 0x000500C0 pour un ordre sans réponse (SPI_cmd0005, 0x103fee).' } },
  // ptm.md, ligne 385.
  { service: 'pxi:mc', id: '0x000A', h: '0x000A00C0', n: UNNAMED, note: 'Sets internal Process9 date/time, same as Legacy_FIRM_PXI#Command_0xA', depuis: '1.0.0-0', url: URL_PXIMC, seen: { module: 'ptm',
    text: '3dbrew ne donne que 0x000A.... ptm envoie 0x000A00C0 pour donner l\'heure à Process9, au démarrage puis toutes les heures (PXIMC_cmd000A, 0x1036b0).' } }
];

/* Numéros que le code traite sans vérifier le reste de l'en-tête : la requête reste inconnue, l'entrée reste
   parmi les en-têtes incomplets, avec ce que le code en fait. */
const PARTIAL_NOTES = [
  // cfg.md, lignes 150, 153, 154 et 156 : colonne « En-tête vérifié » à « numéro ».
  { services: ['cfg:i'], id: '0x0819', seen: { module: 'cfg',
    text: 'Le code ne regarde que le numéro et répond 0x08190040 : même travail que la commande 0x040A (write_config_to_evac, 0x108844).' } },
  { services: ['cfg:i'], id: '0x081C', seen: { module: 'cfg',
    text: 'Le code ne regarde que le numéro et répond 0x081C0040 : même travail que la commande 0x040B (delete_evac_save, 0x108828).' } },
  { services: ['cfg:i'], id: '0x081D', seen: { module: 'cfg',
    text: 'Le code ne regarde que le numéro et répond 0x081D0040 : il recalcule le bloc 0x00040004 et enregistre (reset_block_00040004, 0x107fac).' } },
  { services: ['cfg:i'], id: '0x081F', seen: { module: 'cfg',
    text: 'Le code ne regarde que le numéro et répond 0x081F0040 : il recalcule le bloc 0x00180001 et enregistre (reset_block_00180001, 0x107f78).' } },
  // ptm.md, lignes 175, 176 et 183 ; les deux services partagent l'aiguillage ptmsysm_handle_command (ligne 108).
  { services: ['ptm:sysm', 'ptm:s'], id: '0x0816', seen: { module: 'ptm',
    text: 'Le code ne regarde que le numéro et répond 0x081600C0 : il lit l\'horloge du microcontrôleur et rend un nombre de 64 bits (ptmsysm_GetRtcTime, 0x1099b8).' } },
  { services: ['ptm:sysm', 'ptm:s'], id: '0x0817', seen: { module: 'ptm',
    text: 'Le code ne regarde que le numéro et répond 0x08170040 : il découpe une heure en six champs et les envoie à mcu::RTC (ptmsysm_SetRtcTime, 0x1099d0).' } },
  // hid.md, lignes 96, 108, 109 et 130 à 138 ; l'aiguillage ne vérifie jamais le reste de l'en-tête (ligne 119).
  { services: ['hid:SPVR'], id: '0x0003', seen: { module: 'hid',
    text: 'Le code ne regarde que le numéro et répond 0x00030040 : il recharge l\'étalonnage tactile depuis le bloc de configuration 0x00040000 (hid_cmd0003, 0x107340).' } },
  { services: ['hid:SPVR'], id: '0x000F', seen: { module: 'hid',
    text: 'Le code ne regarde que le numéro et répond 0x000F0040 : il règle trois paramètres de la conversion du pad circulaire en directions (hid_cmd000F, 0x10715c).' } },
  { services: ['hid:SPVR'], id: '0x0010', seen: { module: 'hid',
    text: 'Le code ne regarde que le numéro et répond 0x00100100 : il rend ces trois paramètres (hid_cmd0010, 0x107138).' } }
];

/* ------------------------------------------------------------ 4. ce que le code dit d'un service entier */
const SERVICE_NOTES = [
  // fs.md, lignes 340 et 383 à 469 : 83 requêtes ; le tableau de 3dbrew en a 86, les 83 en-têtes y sont à l'identique.
  { services: ['PxiFS0', 'PxiFS1', 'PxiFSB', 'PxiFSR'], seen: { module: 'fs',
    text: 'fs envoie 83 des 86 requêtes de ce tableau, avec exactement ces en-têtes ; il n\'envoie pas 0x003D0040, 0x00530000 ni 0x00540000. Il choisit le canal d\'après la priorité de la commande : PxiFSR pour -16, PxiFSB pour 8 et 16, PxiFS0 ou PxiFS1 pour le reste.' } },
  // loader.md, lignes 79 et 232 à 234.
  { services: ['PxiPM'], seen: { module: 'loader',
    text: 'loader envoie les trois requêtes de ce tableau, avec exactement ces en-têtes. La question va à fs:REG si la moitié haute du numéro de programme vaut 0xFFFF0000 ou si fs:REG reconnaît le numéro ; sinon elle va à PxiPM.' } },
  // pxi.md, lignes 57, 181, 182 et 198 à 200.
  { services: ['pxi:mc'], seen: { module: 'pxi',
    text: 'pxi envoie lui-même 0x00010000 à Process9 après la notification 0x100, et surveille au passage la commande 5 des autres modules.' } },
  // fs.md, ligne 303 ; contrat-fs.md, ligne 968.
  { services: ['fs:USER'], seen: { module: 'fs',
    text: 'Les tailles ne sont jamais prises dans les mots ordinaires : Read, Write, la lecture d\'un dossier et les commandes qui portent un chemin ont un mot « taille » que fs ne lit pas, la taille vient du descripteur du tampon. Pour la lecture d\'un dossier, le nombre d\'entrées est la taille du tampon divisée par 0x228. La structure ExtSaveDataInfo occupe 3 mots recopiés, pas 4 ; le quatrième mot vaut toujours 0 dans Pokémon X.' } }
];

/* ------------------------------------------------------------ 5. services appelés
   Les sessions que le code ouvre, quand la Carte ne les avait pas : la ligne « Services appelés » de chaque fiche et
   son tableau de requêtes. srv:, que tout module ouvre, et le port err:f ne sont pas repris. */
const CALLS = [
  // cfg.md, lignes 16, 20 et 399 à 416.
  { module: 'cfg', service: 'fs:USER', note: 'cfg ouvre des archives de la NAND et y tient le fichier config, les fichiers signés et HWCAL.' },
  { module: 'cfg', service: 'ps:ps', note: 'cfg fait vérifier la signature de ses fichiers signés et tire des octets au hasard ; il ouvre ps:ps avant chaque usage et le referme.' },
  // dsp.md, lignes 16, 441 à 444, 447 et 458.
  { module: 'dsp', service: 'ptm:s', note: 'dsp demande si la console est une New 3DS et prévient ptm qu\'il est prêt pour la veille.' },
  { module: 'dsp', service: 'cfg:s', note: 'dsp lit le bloc de configuration 0x00070000, le temps de LoadComponent.' },
  { module: 'dsp', service: 'ps:ps', note: 'dsp fait vérifier la signature du composant, le temps de LoadComponent.' },
  // fs.md, lignes 16 et 340.
  { module: 'fs', service: 'PxiFS0', note: 'fs transmet à Process9 par ce canal les commandes de priorité ordinaire.' },
  { module: 'fs', service: 'PxiFS1', note: 'fs transmet à Process9 par ce canal les commandes de priorité ordinaire.' },
  { module: 'fs', service: 'PxiFSB', note: 'fs transmet à Process9 par ce canal les commandes de priorité 8 et 16.' },
  { module: 'fs', service: 'PxiFSR', note: 'fs transmet à Process9 par ce canal les commandes de priorité -16.' },
  // gsp.md, lignes 16, 442, 443 et 466.
  { module: 'gsp', service: 'cfg:s', note: 'gsp demande le modèle de la console et lit les réglages des écrans.' },
  // hid.md, lignes 16, 228 à 232 et 350.
  { module: 'hid', service: 'cfg:s', note: 'hid lit et écrit les étalonnages, puis fait enregistrer la configuration.' },
  { module: 'hid', service: 'ptm:s', note: 'hid demande si la console est une New 3DS et prévient ptm qu\'il est prêt pour la veille.' },
  // loader.md, lignes 16, 17, 79 et 222 à 234.
  { module: 'loader', service: 'fs:LDR', note: 'loader se présente au système de fichiers et ouvre le .code du programme.' },
  { module: 'loader', service: 'fs:REG', note: 'loader y lit l\'exheader, y enregistre et en retire un programme.' },
  { module: 'loader', service: 'PxiPM', note: 'loader pose les mêmes questions à Process9 quand fs:REG ne reconnaît pas le programme.' },
  // ns.md, lignes 16, 508 à 518 et 624.
  { module: 'ns', service: 'am:u', note: 'ns lit la fiche d\'un titre installé, vérifie les droits, installe une mise à jour ; il ouvre la session sous le nom am:u.' },
  { module: 'ns', service: 'fs:USER', note: 'ns demande quelle cartouche est là, déclare des contenus spéciaux, lit la police.' },
  { module: 'ns', service: 'ptm:sysm', note: 'ns passe par ptm:sysm pour la veille, l\'arrêt, le redémarrage et l\'état du couvercle.' },
  { module: 'ns', service: 'cfg:s', note: 'ns lit la région, le modèle et des réglages.' },
  { module: 'ns', service: 'cam:s', note: 'ns reprend et rend la caméra quand on passe par le menu HOME.' },
  { module: 'ns', service: 'ps:ps', note: 'ns fait chiffrer et déchiffrer, pour Wrap et Unwrap.' },
  { module: 'ns', service: 'nwm::EXT', note: 'ns envoie une requête à nwm::EXT (0x00060000), pour le Wi-Fi.' },
  // pm.md, lignes 16 et 266 à 274.
  { module: 'pm', service: 'srv:pm', note: 'pm donne à sm la liste des services permis à chaque nouveau processus, et la retire à sa fin.' },
  { module: 'pm', service: 'Loader', note: 'pm fait créer le processus par loader, y déclare et en retire les titres.' },
  { module: 'pm', service: 'fs:REG', note: 'pm déclare chaque processus à fs, et le retire à sa fin.' },
  // ptm.md, lignes 17, 384 à 399 et 525.
  { module: 'ptm', service: 'pxi:mc', note: 'ptm prévient Process9 avant de dormir et après, et lui envoie l\'heure.' },
  { module: 'ptm', service: 'pm:app', note: 'ptm fait arrêter tous les processus (PrepareForReboot).' },
  { module: 'ptm', service: 'cfg:s', note: 'ptm lit et écrit des blocs de configuration.' },
  { module: 'ptm', service: 'fs:USER', note: 'ptm monte l\'archive ptmdb: et y tient Pedometer.dat et PlayHistory.dat.' }
];
const CALL_TEXT = 'Lien lu dans le code : le module ouvre cette session.';

/* Liens que 3dbrew donne et que le code ne montre pas : ils restent, avec ce que dit le code. */
const CALL_NOTES = [
  // ptm.md, lignes 98 et 525.
  { module: 'ptm', service: 'ns:p', seen: { module: 'ptm',
    text: 'Le code de ptm n\'ouvre pas ns:p : l\'exheader autorise six noms (mcu::RTC, fs:USER, cfg:s, pxi:mc, pm:app, pdn:s) et ce sont les six que le code ouvre. Il apprend l\'état du couvercle par les notifications 0x213 et 0x214.' } },
  // ns.md, ligne 624.
  { module: 'ns', service: 'am:sys', seen: { module: 'ns',
    text: 'Le code de ns ouvre la session d\'am sous le nom am:u (chaîne à 0x120308), celui que l\'exheader autorise.' } }
];

/* ------------------------------------------------------------ 6. descripteurs de traduction manquants
   Page IPC de 3dbrew, « Usage Examples for other Translation Types » : l'extraction les avait sautés.
   pxi.md, ligne 107, montre le premier à l'œuvre (taille << 8 | 4). */
const TRANSLATIONS = [
  { after: '0x00000002', entry: { motif: '0x00000004', nom: 'Tampon passé par PXI, en lecture et écriture',
    desc: '(taille<<8)|(index<<4)|4, puis un pointeur : le noyau écrit dans un tampon statique du destinataire la liste des morceaux de mémoire physique du tampon (adresse, taille) et remplace le pointeur par l\'adresse physique de cette liste. C\'est ainsi qu\'un tampon arrive jusqu\'à l\'ARM9.' } },
  { after: '0x00000004', entry: { motif: '0x00000006', nom: 'Tampon passé par PXI, en lecture seule',
    desc: '(taille<<8)|(index<<4)|6, puis un pointeur : comme le précédent, pour un tampon que le destinataire ne fait que lire.' } }
];

/* ------------------------------------------------------------ 7. une page relue
   La page Cdc:HID:GetData était marquée « page non lue ». Elle est citée par la note de la commande : la voici. */
const READ_PAGES = [
  { service: 'cdc:HID', h: '0x00010042', page: 'Cdc:HID:GetData',
    details: { req: [], rep: [['1', 'Result code [0xD8603BEF if no data available]'], ['2', 'Touchscreen data'], ['3', 'Circle pad data']] } }
];

/* ============================================================ application */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = x => JSON.parse(JSON.stringify(x));
const commandId = h => h.slice(0, 6);

function applyCorrections(D, pxi) {
  const done = [], problems = [];
  const services = new Map(D.services.map(s => [s.id, s]));
  const modules = new Map(D.modules.map(m => [m.id, m]));
  const service = (id, what) => {
    const s = services.get(id);
    if (!s) problems.push(what + ' : le service ' + id + ' n\'est pas dans la Carte');
    return s;
  };
  // Pose une valeur et le note si elle change quelque chose.
  const set = (obj, key, value, what) => {
    if (same(obj[key], value)) return;
    obj[key] = clone(value);
    done.push(what);
  };
  // Ajoute une note « seen » à une entrée, sans doublon.
  const addSeen = (obj, note, what) => {
    const list = obj.seen || [];
    if (list.some(n => same(n, note))) return;
    // une note du même module sur le même sujet remplace l'ancienne version de son texte
    const kept = list.filter(n => !(n.module === note.module && n.h === note.h && !!n.byCode === !!note.byCode));
    obj.seen = kept.concat([clone(note)]);
    done.push(what);
  };

  set(D, 'codeSource', CODE_SOURCE, 'codeSource : d\'où viennent les notes « vu dans le code »');
  if (D.source && typeof D.source.note === 'string' && !D.source.note.includes('corrections.js')) {
    D.source.note += SOURCE_NOTE;
    done.push('source : mention des corrections');
  }

  // --- les tableaux des services de pxi, tirés de 3dbrew
  // Un tableau déjà en place n'est pas touché : on le reconnaît en retirant ce que le code y a ajouté.
  const fromCode = c => (c.seen || []).some(n => n.byCode);
  const bare = list => (list || []).map(x => { const y = clone(x); delete y.seen; return y; });
  for (const table of pxi.tables) {
    for (const id of table.services) {
      const s = service(id, 'tableau PXI');
      if (!s) continue;
      const completed = new Set(s.commandes.filter(fromCode).map(c => commandId(c.h)));
      const inPlace = same(bare(s.commandes.filter(c => !fromCode(c))), table.commandes) &&
        same(bare(s.partiels), table.partiels.filter(p => !completed.has(p.id))) && s.url === table.url && !s.sansTable;
      if (inPlace) continue;
      s.commandes = clone(table.commandes);
      if (table.partiels.length) s.partiels = clone(table.partiels); else delete s.partiels;
      s.url = table.url;
      delete s.sansTable;
      done.push('tableau de 3dbrew : ' + id + ', ' + table.commandes.length + ' commandes (' + table.page + ')');
    }
  }

  // --- noms tronqués
  for (const s of D.services) {
    for (const c of s.commandes) {
      if (!c.note || !c.note.startsWith(c.n) || c.note === c.n) continue;
      const rest = c.note.slice(c.n.length);
      let name = null;
      if (TYPE_WORDS.includes(c.n) && /^\s/.test(rest)) {
        const m = c.note.match(SIGNATURE);
        name = m ? m[1] : UNNAMED;
      } else if (PROSE_WORDS.includes(c.n) && /^[\s,.:]/.test(rest)) {
        name = UNNAMED;
      }
      if (name) set(c, 'n', name, 'nom tronqué : ' + s.id + ' ' + c.h + ' « ' + c.n + ' » devient « ' + name + ' »');
    }
  }
  for (const fix of PARTIAL_TEXTS) {
    for (const id of fix.services) {
      const s = service(id, 'nom tronqué d\'un en-tête incomplet');
      const p = s && (s.partiels || []).find(x => x.id === fix.id);
      if (!p) continue;   // l'en-tête a pu être complété plus bas, ou par 3dbrew
      if (PARTIAL_PROSE_WORDS.includes(p.n)) set(p, 'n', UNNAMED, 'nom tronqué : ' + id + ' ' + p.brut + ' « ' + p.n + ' » devient « ' + UNNAMED + ' »');
      if (p.n === UNNAMED) set(p, 'note', fix.text, 'texte de 3dbrew rendu à ' + id + ' ' + p.brut);
    }
  }

  // --- en-têtes complétés par le code
  for (const fix of COMPLETED_HEADERS) {
    const s = service(fix.service, 'en-tête complété');
    if (!s) continue;
    const others = s.commandes.filter(c => commandId(c.h) === fix.id && c.h !== fix.h);
    if (others.length) {
      problems.push(fix.service + ' ' + fix.id + ' : la Carte a maintenant ' + others[0].h + ', le code donne ' + fix.h + ' ; à traiter comme une divergence');
      continue;
    }
    const partial = (s.partiels || []).find(p => p.id === fix.id);
    let command = s.commandes.find(c => c.h === fix.h);
    if (!partial && !command) {
      problems.push(fix.service + ' ' + fix.id + ' : ni en-tête incomplet ni commande ' + fix.h + ' dans la Carte');
      continue;
    }
    if (partial) {
      s.partiels = s.partiels.filter(p => p !== partial);
      if (!s.partiels.length) delete s.partiels;
    }
    if (!command) {
      command = { h: fix.h, n: fix.n, url: fix.url };
      if (fix.note) command.note = fix.note;
      if (fix.depuis) command.depuis = fix.depuis;
      s.commandes.push(command);
      s.commandes.sort((a, b) => parseInt(a.h, 16) - parseInt(b.h, 16));
      done.push('en-tête complété par le code : ' + fix.service + ' ' + fix.h);
    }
    addSeen(command, { module: fix.seen.module, byCode: true, text: fix.seen.text }, 'note du code : ' + fix.service + ' ' + fix.h);
  }

  // --- divergences
  for (const fix of HEADER_NOTES) {
    const s = service(fix.service, 'divergence');
    if (!s) continue;
    const c = s.commandes.find(x => x.h === fix.h3dbrew);
    if (!c) { problems.push(fix.service + ' : la Carte n\'a plus l\'en-tête ' + fix.h3dbrew + ' attendu de 3dbrew'); continue; }
    if (fix.seen.h && commandId(fix.seen.h) !== commandId(c.h)) { problems.push(fix.service + ' ' + c.h + ' : l\'en-tête du code ' + fix.seen.h + ' n\'a pas le même numéro'); continue; }
    addSeen(c, fix.seen, 'note du code : ' + fix.service + ' ' + c.h);
  }
  for (const fix of PARTIAL_NOTES) {
    for (const id of fix.services) {
      const s = service(id, 'note d\'en-tête incomplet');
      const p = s && (s.partiels || []).find(x => x.id === fix.id);
      if (!p) { if (s) problems.push(id + ' : la Carte n\'a plus l\'en-tête incomplet ' + fix.id); continue; }
      addSeen(p, fix.seen, 'note du code : ' + id + ' ' + p.brut);
    }
  }
  for (const fix of SERVICE_NOTES) {
    for (const id of fix.services) {
      const s = service(id, 'note de service');
      if (s) addSeen(s, fix.seen, 'note du code : service ' + id);
    }
  }

  // --- pages relues
  for (const fix of READ_PAGES) {
    const s = service(fix.service, 'page relue');
    const c = s && s.commandes.find(x => x.h === fix.h);
    if (!c) { if (s) problems.push(fix.service + ' : pas de commande ' + fix.h + ' pour la page ' + fix.page); continue; }
    set(D.details, fix.page, fix.details, 'page relue : ' + fix.page);
    if (c.nonLue) { delete c.nonLue; done.push('page relue : ' + fix.service + ' ' + c.h + ' n\'est plus « page non lue »'); }
    set(c, 'p', fix.page, 'page relue : ' + fix.service + ' ' + c.h + ' renvoie à ses détails');
  }

  // --- services appelés
  for (const fix of CALLS) {
    const m = modules.get(fix.module), s = service(fix.service, 'service appelé par ' + fix.module);
    if (!m) { problems.push('service appelé : le module ' + fix.module + ' n\'est pas dans la Carte'); continue; }
    if (!s) continue;
    if (s.module === m.id) { problems.push(fix.module + ' -> ' + fix.service + ' : un module ne s\'appelle pas lui-même'); continue; }
    const target = { service: fix.service, note: fix.note, seen: [{ module: fix.module, text: CALL_TEXT }] };
    const existing = m.appelle.find(a => a.service === fix.service);
    if (existing && existing.url) continue;   // 3dbrew le dit maintenant : son entrée suffit
    if (!existing) { m.appelle.push(target); done.push('service appelé : ' + fix.module + ' -> ' + fix.service); }
    else if (!same(existing, target)) { Object.assign(existing, target); done.push('service appelé, texte revu : ' + fix.module + ' -> ' + fix.service); }
    if (!(s.appelants || []).includes(m.id)) { s.appelants = (s.appelants || []).concat([m.id]); done.push('correspondance : ' + fix.service + ' appelé par ' + m.id); }
  }
  for (const fix of CALL_NOTES) {
    const m = modules.get(fix.module);
    const a = m && m.appelle.find(x => x.service === fix.service);
    if (!a) { problems.push(fix.module + ' -> ' + fix.service + ' : ce lien n\'est plus dans la Carte'); continue; }
    addSeen(a, fix.seen, 'note du code : ' + fix.module + ' -> ' + fix.service);
  }

  // --- descripteurs de traduction
  for (const fix of TRANSLATIONS) {
    const list = D.ipc.traductions;
    const at = list.findIndex(t => t.motif === fix.entry.motif);
    if (at >= 0) { if (!same(list[at], fix.entry)) { list[at] = clone(fix.entry); done.push('descripteur de traduction revu : ' + fix.entry.motif); } continue; }
    const previous = list.findIndex(t => t.motif === fix.after);
    if (previous < 0) { problems.push('descripteur ' + fix.entry.motif + ' : pas de descripteur ' + fix.after + ' après lequel le ranger'); continue; }
    list.splice(previous + 1, 0, clone(fix.entry));
    done.push('descripteur de traduction ajouté : ' + fix.entry.motif);
  }

  return { done, problems };
}

/* ------------------------------------------------------------ lecture et écriture de donnees.js */
function readData(file) {
  const source = fs.readFileSync(file || DATA_FILE, 'utf8');
  const lines = source.split('\n');
  const index = lines.findIndex(l => l.startsWith(MARKER));
  if (index < 0) throw new Error('donnees.js : ligne « ' + MARKER + '» introuvable');
  const json = lines[index].slice(MARKER.length).replace(/;\s*$/, '');
  const eol = lines[index].endsWith('\r') ? '\r' : '';   // le fichier garde ses fins de ligne
  return { lines, index, eol, data: JSON.parse(json) };
}
function readPxiTables() {
  return JSON.parse(fs.readFileSync(PXI_FILE, 'utf8'));
}
function render(read, data) {
  const lines = read.lines.slice();
  lines[read.index] = MARKER + JSON.stringify(data) + ';' + read.eol;
  // l'en-tête du fichier dit qu'il est corrigé par ce script
  const end = lines.slice(0, read.index).findIndex(l => l.trimEnd().endsWith('*/'));
  if (end >= 0 && !lines.slice(0, read.index).some(l => l.includes('corrections.js'))) {
    lines[end] = lines[end].replace(/\s*\*\/\s*$/, '');
    lines.splice(end + 1, 0, HEADER_NOTE + read.eol);
  }
  return lines.join('\n');
}

function main(args) {
  const read = readData();
  const data = clone(read.data);
  const { done, problems } = applyCorrections(data, readPxiTables());
  const output = render(read, data);
  const changed = output !== read.lines.join('\n');
  if (args.includes('--list')) for (const line of done) console.log(line);
  for (const p of problems) console.log('NON APPLIQUÉE : ' + p);
  if (args.includes('--check')) {
    console.log(changed ? 'donnees.js n\'est pas à jour : lance « node corrections.js ».' : 'donnees.js est à jour.');
    return changed || problems.length ? 1 : 0;
  }
  if (changed) fs.writeFileSync(DATA_FILE, output);
  console.log(done.length + ' correction' + (done.length > 1 ? 's' : '') + (changed ? ', donnees.js récrit.' : ', donnees.js était déjà à jour.'));
  return problems.length ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { applyCorrections, readData, readPxiTables, CODE_SOURCE, UNNAMED };
