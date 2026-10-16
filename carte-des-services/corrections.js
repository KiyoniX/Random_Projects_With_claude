/* Carte des services : corrections appliquées à donnees.js après sa production.

   donnees.js a été tiré de 3dbrew par un script qui n'est pas dans le dépôt. Depuis, des modules système ont été
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
  modules: ['cfg', 'dsp', 'fs', 'gsp', 'hid', 'loader', 'ns', 'pm', 'ptm', 'pxi', 'sm', 'camera', 'mic', 'ir', 'ndm', 'ac', 'errdisp', 'ssl', 'cecd', 'socket', 'http', 'friends', 'nwm', 'boss',
    'gpio', 'pdn', 'i2c', 'spi', 'mcu', 'codec', 'csnd', 'ps', 'am', 'news', 'act', 'dlp', 'mp', 'nfc', 'mvd', 'nim', 'qtm'],
  note: 'Quarante et un modules système lus dans le code dumpé d\'une New 3DS, une fiche par module. Ce que le code fait sur cette console peut différer de ce que 3dbrew décrit.'
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
  ]),

  // Les corrections du 16 octobre 2026 : relevées par les fiches de camera, mic, ac, ssl et cecd.
  // camera.md, lignes 151 et 157. La Carte et 3dbrew ne nomment pas cette commande.
  { service: 'cam:u', h3dbrew: '0x004000C0', seen: { module: 'camera',
    text: 'camera répond 0x00400040 à cette commande, et la reçoit dans la même fonction de travail que SetEffect (cam_cmd0040, 0x1071dc ; cam_SetEffect, 0x106334, y passe par un simple appel) : c\'est un alias de SetEffect.' } },
  // ac.md, lignes 102 et 534. La Carte porte déjà 0x00150004 (champ « corrige ») ; le module le confirme.
  { service: 'ac:u', h3dbrew: '0x00150004', seen: { module: 'ac',
    text: 'Le module n\'accepte que l\'en-tête entier 0x00150004 (numéro 0x15, quatre mots de traduction : le processus et la poignée copiée) et répond 0x00150040 (acu_0015_ExclusiveAsync, 0x10f4e4) : le 0x00015004 de 3dbrew est une coquille.' } },
  // mic.md, lignes 83, 89 et 254. Le nom SetClientSDKVersion n'est pas confirmé : seulement une note.
  { service: 'mic:u', h3dbrew: '0x00100040', seen: { module: 'mic',
    text: 'Le code reçoit cette commande (0x103ee8), range un octet d\'état (1 si le mot 1 est nul, 0 sinon, en 0x106009) et répond 0x00100040. Pokémon X l\'envoie une fois à l\'ouverture avec 0x050200C8, qui a la forme d\'un numéro de version du SDK (5.2.0) : le nom SetClientSDKVersion est une proposition de la fiche, que 3dbrew ne confirme pas.' } },
  // cecd.md, partie 3. 3dbrew (version de 2020) les nomme RunCommand et RunCommandAlt.
  // socket.md, partie 3 (soc:U, commande 0x22).
  { service: 'soc:U', h3dbrew: '0x00220040', seen: { module: 'socket',
    text: 'Le mot 1 n\'est pas un descripteur de socket : socket la range à +0x18 de l\'enregistrement du client, c\'est la limite du nombre de sockets de ce processus (socket la compare au nombre ouvert, +0x14, et refuse avec 0xD860700C ; InitializeSockets la met à 16). Nom proposé par la fiche : SetSocketLimit (socu_0022, 0x12f304). Le code ne compare que le numéro.' } },
  // socket.md, partie 3 (soc:U, commande 0x23).
  { service: 'soc:U', h3dbrew: '0x00230040', seen: { module: 'socket',
    text: 'Confirmée : met à zéro l\'octet +0x10 du socket (réservé à son propriétaire), qui devient utilisable par tout processus (socu_0023_AddGlobalSocket, 0x12f31c).' } },
  // socket.md, partie 7 (soc:P). Commandes sans nom sur 3dbrew.
  { service: 'soc:P', h3dbrew: '0x000500C0', seen: { module: 'socket',
    text: 'Le code ne regarde que le numéro, lit un octet de genre (0 à 2), un mot et une taille, remplit un tampon statique d\'au plus 0x200 octets avec une table interne et répond 0x00050042 (socp_0005_GetStackInfo, 0x12f024).' } },
  { service: 'soc:P', h3dbrew: '0x00070000', seen: { module: 'socket',
    text: 'Le code rend une poignée copiée et répond 0x00070042 (socp_0007_GetHandle, 0x12c7fc).' } },
  { service: 'soc:P', h3dbrew: '0x00080000', seen: { module: 'socket',
    text: 'Le code rend un mot et répond 0x00080080 (socp_0008_GetValue, 0x12c7e0).' } },
  // http.md, partie 9, ligne 391 (et lignes 209 et 212 du tableau).
  { service: 'http:C', h3dbrew: '0x00370080', seen: { module: 'http',
    text: 'Cette commande (httpc_ctx_0037_SetKeepAliveWord, 0x11890C) range un mot sans le vérifier à +0x358 du contexte ; le booléen est la commande 0x003A.' } },
  { service: 'http:C', h3dbrew: '0x003A0080', seen: { module: 'http',
    text: 'Cette commande (httpc_ctx_003A_SetKeepAliveBool, 0x118120) range un octet à +0x35C du contexte et refuse une valeur de 2 ou plus avec 0xD8E0A002 : c\'est elle qui est le booléen, pas la 0x0037.' } },
  // friends.md, partie 3 (ligne 0x09), partie 9 et tableau des désaccords.
  { service: 'frd:u', h3dbrew: '0x00090000', seen: { module: 'friends',
    text: 'La réponse est 0x000901C0 : six mots, le résultat puis le nom d\'écran de 11 caractères UTF-16 (22 octets, dernier nul), et non huit mots de nom (frd_0009_GetMyScreenName, 0x12784C).' } },
  // friends.md, partie 3 (frd:n) : 0x00010042 rend un événement ; 3dbrew donne 0x00010000.
  { service: 'frd:n', h3dbrew: '0x00040000', seen: { module: 'friends',
    text: 'Le code rend un octet de 0 à 3, l\'état du démon vu par ndm ; la réponse est 0x00040080.' } },
  { service: 'cecd:u', h3dbrew: '0x000B0040', seen: { module: 'cecd',
    text: 'Le mot reçu est une commande du démon (CecCommand de 3dbrew, 0 à 0x15) que le module passe à cec_run_command (0x1139F4) ; la commande 0xE (RESET_FILTER) est traitée sur place. Refusée avec 0xC8A10BF0 quand le démon est occupé. 3dbrew (version de 2020) la nomme RunCommand.' } },
  { service: 'cecd:u', h3dbrew: '0x000C0040', seen: { module: 'cecd',
    text: 'Même appel que la commande 0xB (cec_run_command), avec une condition de refus différente pour les commandes OVER_BOSS (0x12 à 0x14) : le nom Stop est trompeur, 3dbrew (version de 2020) la nomme RunCommandAlt et note qu\'elle fait la même chose avec quelques contrôles en plus.' } },

  // Le 16 octobre 2026 (suite) : relevées par les fiches de nwm et de boss.
  // nwm.md, ligne 99 (« Écarts avec la Carte ») ; la table de la partie 3, lignes 0x0E et 0x1F.
  { service: 'nwm::UDS', h3dbrew: '0x000E0006', seen: { module: 'nwm',
    text: 'Le code traite cette commande dans l\'aiguillage lui-même (gestionnaire 0x10b07c) et appelle la même fonction que pour 0x001F0006, uds_decrypt_beacon_data (0x12022C) : elle prend le réseau annoncé et deux tampons de balises et rend 0x280 octets, seize NodeInfo de 0x28 ; réponse 0x000E0042.' } },
  { service: 'nwm::UDS', h3dbrew: '0x001F0006', seen: { module: 'nwm',
    text: 'Le code appelle ici la même fonction que pour 0x000E0006, uds_decrypt_beacon_data (0x12022C) : elle rend 0x280 octets, seize NodeInfo de 0x28, après un déchiffrement AES dont la clé est dans le module ; réponse 0x001F0042 (gestionnaire 0x10b0e8). D\'autres documents l\'appellent DecryptBeaconData.' } },
  // nwm.md, ligne 99 : « Unbind (0x13) répond avec quatre mots de plus que le résultat ».
  { service: 'nwm::UDS', h3dbrew: '0x00130040', seen: { module: 'nwm',
    text: 'Le code répond 0x00130140 : le résultat puis quatre mots, que la Carte ne connaît pas (uds_cmd_0013_Unbind, 0x10B238). Pokémon X envoie cette commande avec 0x00130040.' } },
  // boss.md, ligne 264 (« Écarts avec la Carte ») et table de boss:M, ligne 0x3.
  { service: 'boss:M', h3dbrew: '0x00030040', seen: { module: 'boss',
    text: 'Le code ne compare que le numéro de la commande 3 (gestionnaire 0x1389fc) et répond 0x00030040 ; l\'en-tête de la Carte n\'est donc pas exigé.' } },
];

/* ------------------------------------------------------------ 3. en-têtes incomplets sur 3dbrew, complétés par le code
   L'entrée quitte la liste des en-têtes incomplets et entre dans le tableau, marquée byCode. */
const URL_CFGI = 'https://www.3dbrew.org/wiki/Config_Services#Config_service_"cfg:i"';
const URL_SPI = 'https://www.3dbrew.org/wiki/SPI_Services#SPI_Service_Commands';
const URL_PXIMC = 'https://www.3dbrew.org/wiki/Mode_Control_Services_PXI#"pxi:mc"_service';
const URL_IRUSER = 'https://www.3dbrew.org/wiki/IR_Services#IR_Service_"ir:USER"';
const URL_NDM = 'https://www.3dbrew.org/wiki/NDM_Services';
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
    text: '3dbrew ne donne que 0x000A.... ptm envoie 0x000A00C0 pour donner l\'heure à Process9, au démarrage puis toutes les heures (PXIMC_cmd000A, 0x1036b0).' } },
  // ir.md, lignes 94, 99, 105, 269, 270 et 279. 3dbrew nomme ces deux commandes sans donner l'en-tête entier ; Pokémon X envoie
  // ceux-ci (iruser_cmd_00110040, 0x1e6958 ; iruser_cmd_00160000, 0x1e68bc) et le module ne vérifie que le numéro.
  { service: 'ir:USER', id: '0x0011', h: '0x00110040', n: 'GetLatestReceiveErrorResult', url: URL_IRUSER, seen: { module: 'ir',
    text: '3dbrew ne donne que 0x0011.... Pokémon X envoie 0x00110040 (un mot : non nul pour remettre le résultat à zéro) ; le module ne regarde que le numéro et répond 0x00110080, le résultat puis le dernier code d\'erreur de réception (iruser_GetLatestReceiveErrorResult, 0x10d42c).' } },
  { service: 'ir:USER', id: '0x0016', h: '0x00160000', n: 'GetSendSizeFreeAndUsed', url: URL_IRUSER, seen: { module: 'ir',
    text: '3dbrew ne donne que 0x0016.... Pokémon X envoie 0x00160000 ; le module ne regarde que le numéro et répond 0x00160140, le résultat puis quatre mots : octets libres, cases libres, octets utilisés, cases utilisées (iruser_GetSendSizeFreeAndUsed, 0x10d1e8).' } },
  // ndm.md, lignes 115, 117, 336 et 351. 3dbrew s'arrête à 0x17 ; le module a une 24e commande.
  { service: 'ndm:u', id: '0x0018', h: '0x00180004', n: UNNAMED, add: true, url: URL_NDM, seen: { module: 'ndm',
    text: 'Absente de 3dbrew, qui s\'arrête à 0x0017. Le module l\'accepte avec l\'en-tête entier 0x00180004 (aucun mot ordinaire, quatre mots de traduction) et répond 0x00180040 (ndmu_0018, 0x106e20) : elle remplace une poignée gardée dans l\'ordonnanceur. Aucun client connu.' } }
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
    text: 'Le code ne regarde que le numéro et répond 0x00100100 : il rend ces trois paramètres (hid_cmd0010, 0x107138).' } },

  // Le 16 octobre 2026. ir.md, lignes 95 à 105 : les cinq autres commandes de ir:USER que 3dbrew donne sans l'en-tête entier
  // (les deux que Pokémon X envoie, 0x0011 et 0x0016, entrent dans le tableau plus haut).
  { services: ['ir:USER'], id: '0x0012', seen: { module: 'ir',
    text: 'Le code ne regarde que le numéro et répond 0x00120080 : même travail que la commande 0x0011, avec le dernier code d\'erreur d\'envoi (iruser_GetLatestSendErrorResult, 0x10d2f0).' } },
  { services: ['ir:USER'], id: '0x0013', seen: { module: 'ir',
    text: 'Le code ne regarde que le numéro et répond 0x00130080 : il rend l\'octet de liaison (iruser_GetConnectionStatus, 0x10c7cc).' } },
  { services: ['ir:USER'], id: '0x0014', seen: { module: 'ir',
    text: 'Le code ne regarde que le numéro et répond 0x00140080 (iruser_GetTryingToConnectStatus, 0x10d348).' } },
  { services: ['ir:USER'], id: '0x0015', seen: { module: 'ir',
    text: 'Le code ne regarde que le numéro et répond 0x00150140 : il rend quatre mots (iruser_GetReceiveSizeFreeAndUsed, 0x10d3bc).' } },
  { services: ['ir:USER'], id: '0x0017', seen: { module: 'ir',
    text: 'Le code ne regarde que le numéro et répond 0x00170080 : il rend l\'octet du rôle de la liaison (iruser_GetConnectionRole, 0x10c564).' } },
  // cecd.md, parties 2 et 3.
  { services: ['cecd:s'], id: '0x0401', seen: { module: 'cecd',
    text: 'Le code ne regarde que le numéro et répond 0x04010040 (cecds_0401_Unknown0401, 0x118D74) : le module accepte donc cette commande sur cecd:s.' } },
  { services: ['cecd:s'], id: '0x0417', seen: { module: 'cecd',
    text: 'Le code ne regarde que le numéro et répond 0x04170080 (cecds_0417_Unknown0417, 0x118F50) : le module accepte donc cette commande sur cecd:s.' } },
  { services: ['cecd:u'], id: '0x0021', seen: { module: 'cecd',
    text: 'Le code ne regarde que le numéro et répond 0x00210080 (cecdu_0021_Unknown0021, 0x11C3E4).' } }
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
,

  // Le 16 octobre 2026.
  // cecd.md, parties 2 et 3.
  { services: ['cecd:s'], seen: { module: 'cecd',
    text: 'Le module accepte sur cecd:s 38 commandes : les 22 commandes de cecd:u (0x0001 à 0x0012, 0x001E à 0x0021), à d\'autres adresses mais appelant les mêmes fonctions du moteur, plus 16 qui lui sont propres : 0x0401, 0x0402, 0x040A à 0x0417 (aiguillage cecds_handle_command, 0x11AF50). 0x0401 et 0x0417 sont acceptées par le numéro seul.' } },
  { services: ['cecd:u'], seen: { module: 'cecd',
    text: 'Le module accepte 22 commandes sur cecd:u : 0x0001 à 0x0012 (18) et 0x001E à 0x0021 (aiguillage cecdu_handle_command, 0x11A5BC). Les 12 qui touchent aux fichiers ou aux données (0x0001 à 0x000A, 0x0011, 0x0012) répondent 0xC8A10BF0 sans rien faire quand le contrôle du démon refuse.' } },
  { services: ['cecd:ndm'], seen: { module: 'cecd',
    text: 'Les huit commandes de cecd:ndm sont exactement celles que ndm envoie. SuspendDaemon envoie la commande du démon 8 (NDM_SUSPEND) si son booléen est nul, 9 (NDM_SUSPEND_IMMEDIATE) sinon ; ResumeDaemon envoie 7 (NDM_RESUME).' } },
  // ssl.md, parties 2 et 3.
  { services: ['ssl:C'], seen: { module: 'ssl',
    text: 'Le module accepte les 32 commandes de 0x0001 à 0x0020 et aucune autre. Une session a trois états : vide, principale (après Initialize : listes de certificats, contextes), de contexte (après InitializeConnectionSession : Read, Write, StartConnection...). Une commande faite dans le mauvais état rend 0xD960BBF4 ; seules SeedRNG et GenerateRandomData valent dans les deux. Les commandes 0x13, 0x14, 0x15, 0x17 et 0x1E passent par une file de travail.' } },
  // ndm.md, partie 3.
  { services: ['ndm:u'], seen: { module: 'ndm',
    text: 'Le module accepte 24 commandes, 0x0001 à 0x0018 : 3dbrew s\'arrête à 0x0017 (la 24e est ajoutée avec la marque « vu dans le code »).' } },

  // Le 16 octobre 2026 (suite). nwm.md : sessions au plus à la ligne 15, nombres de commandes aux titres des parties 3 et 4.
  { services: ['nwm::UDS'], seen: { module: 'nwm',
    text: 'Le module accepte 35 commandes, 0x0001 à 0x0023, celles de 3dbrew, sur 2 sessions au plus : les deux sessions que Pokémon X ouvre, pour 22 commandes (la seconde ne sert qu\'à PullPacket).' } },
  { services: ['nwm::INF'], seen: { module: 'nwm',
    text: 'Le module accepte 16 commandes, 0x0001 à 0x0010 (comme la Carte), sur 2 sessions au plus.' } },
  { services: ['nwm::SOC'], seen: { module: 'nwm',
    text: 'Le module accepte 13 commandes, 0x0001 à 0x000D (comme la Carte), sur 4 sessions au plus.' } },
  { services: ['nwm::EXT'], seen: { module: 'nwm',
    text: 'Le module accepte 9 commandes, 0x0001 à 0x0009 (comme la Carte), sur 6 sessions au plus.' } },
  // nwm.md, ligne 176 : la Carte n'a que 0x00060002 et 0x000D0082, dont les en-têtes complets sont ceux du code.
  { services: ['nwm::CEC'], seen: { module: 'nwm',
    text: 'Le module accepte 30 commandes, 0x0001 à 0x001E, sur 4 sessions au plus ; la Carte n\'en connaît que deux, 0x00060002 et 0x000D0082, dont le code vérifie les en-têtes entiers. Les 28 autres ont des gestionnaires et des réponses lus (aiguillage 0x1049CC) mais aucun nom.' } },
  // nwm.md, lignes 52, 225 et 274 : attribution par le rang dans la table d'octets, donc interprétée ; aucun jeu n'appelle ces deux services.
  { services: ['nwm::SAP'], seen: { module: 'nwm',
    text: 'Le module accepte 44 commandes, 0x0001 à 0x002C (aiguillage 0x1051E0), sur 2 sessions au plus ; 3dbrew n\'en donne aucune. Attribution interprétée : ce service est reconnu par son rang dans la table d\'octets qui donne les aiguillages (rang 2), pas par une chaîne ni par un appelant. Aucun jeu ne l\'appelle.' } },
  { services: ['nwm::TST'], seen: { module: 'nwm',
    text: 'Le module accepte 70 commandes, 0x0001 à 0x0046 (aiguillage 0x106158), sur 1 session au plus ; 3dbrew n\'en donne aucune. Attribution interprétée : ce service est reconnu par son rang dans la table d\'octets qui donne les aiguillages (rang 6), pas par une chaîne ni par un appelant. Aucun jeu ne l\'appelle.' } },
  // boss.md, ligne 15 (sessions), partie 2 (nombres de commandes), partie 3 (codes de résultat), ligne 355 (attributions interprétées).
  { services: ['boss:U'], seen: { module: 'boss',
    text: 'Le module accepte 55 commandes, 0x0001 à 0x0037, celles de 3dbrew, sur 2 sessions au plus. Pokémon X en envoie 28. Toute commande autre que SendPropertyHandle (0x0015) répond 0xC8A0F82B tant qu\'InitializeSession (0x0001) n\'a pas été passée sur la session.' } },
  { services: ['boss:P'], seen: { module: 'boss',
    text: 'Le module accepte 143 commandes, 0x0001 à 0x0037 et 0x0401 à 0x0458 : les 55 de boss:U (à d\'autres adresses) plus 88 privilégiées qui prennent en plus un identifiant de programme ; 4 sessions au plus. L\'attribution de l\'aiguillage 0x131C30 à boss:P est interprétée (nombre de commandes, en-têtes, ordre des chaînes). Pokémon X ne l\'ouvre jamais.' } },
  { services: ['boss:M'], seen: { module: 'boss',
    text: 'Le module accepte 7 commandes, 0x0001 à 0x0007 (aiguillage 0x130C00), sur 1 session au plus. L\'attribution à boss:M est interprétée (nombre de commandes, en-tête 0x00010002, ordre des chaînes). Elle est appelée par ndm, jamais par un jeu.' } }
];

/* ------------------------------------------------------------ 5. services appelés
   Les sessions que le code ouvre, quand la Carte ne les avait pas : la ligne « Services appelés » de chaque fiche et
   son tableau de requêtes. srv:, que tout module ouvre, et le port err:f ne sont pas repris. */
const EXHEADER_TEXT = 'Lien lu dans l\'exheader du module : il déclare cette session. Le code ne la montre pas ouverte, ou ce qu\'il en fait n\'est pas lu.';
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
  { module: 'ptm', service: 'fs:USER', note: 'ptm monte l\'archive ptmdb: et y tient Pedometer.dat et PlayHistory.dat.' },

  // Le 16 octobre 2026. mic.md, lignes 16 et 38.
  { module: 'mic', service: 'ptm:s', note: 'mic ouvre ptm:s et lui annonce qu\'il est prêt pour la veille.' },
  // ndm.md, lignes 16 et 253 à 270 : les huit services de l'exheader sont ouverts par le code.
  { module: 'ndm', service: 'ac:u', note: 'ndm pilote la connexion Wi-Fi : 25 requêtes à ac:u, dont EnterExclusiveState de sa propre bibliothèque.' },
  { module: 'ndm', service: 'cecd:ndm', note: 'ndm suspend et relance le démon StreetPass : les huit commandes de cecd:ndm.' },
  { module: 'ndm', service: 'nim:ndm', note: 'ndm suspend et relance le démon des mises à jour.' },
  { module: 'ndm', service: 'frd:n', note: 'ndm suspend et relance le démon de la liste d\'amis.' },
  { module: 'ndm', service: 'boss:M', note: 'ndm suspend et relance le démon SpotPass.' },
  { module: 'ndm', service: 'nwm::EXT', note: 'ndm envoie une requête à nwm::EXT (0x00050002).' },
  { module: 'ndm', service: 'ptm:s', note: 'ndm demande à ptm pourquoi la console s\'est réveillée et annonce qu\'il est prêt pour la veille.' },
  // ac.md, lignes 16, 35 à 40 et 427 à 439 : les services ouverts par le code (ac:u et soc:U sont autorisés, pas vus ouverts).
  { module: 'ac', service: 'ptm:s', note: 'ac demande si la console est une New 3DS pour choisir son nombre de sessions.' },
  { module: 'ac', service: 'cfg:s', note: 'ac lit des blocs de configuration.' },
  { module: 'ac', service: 'cfg:nor', note: 'ac ouvre la mémoire flash de configuration.' },
  { module: 'ac', service: 'ps:ps', note: 'ac envoie deux commandes à ps:ps (numéros 6 et 8).' },
  { module: 'ac', service: 'nwm::INF', note: 'ac se connecte aux points d\'accès par nwm::INF.' },
  { module: 'ac', service: 'soc:P', note: 'ac ouvre soc:P.' },
  { module: 'ac', service: 'http:C', note: 'ac ouvre http:C.' },
  { module: 'ac', service: 'fs:USER', note: 'ac lit et écrit ses réglages réseau dans un fichier.' },
  // http.md, lignes 16, 307 et 310.
  { module: 'http', service: 'ssl:C', note: 'http envoie 24 commandes différentes à ssl:C.' },
  { module: 'http', service: 'ptm:s', note: 'http demande à ptm si la console est une New 3DS (CheckNew3DS, 0x040A0000).' },
  // ssl.md, carte d'identité (exheader et chaînes du code).
  { module: 'ssl', service: 'ps:ps', note: 'ssl transmet SeedRNG et GenerateRandomData à ps:ps (commandes 0xC et 0xD).' },
  { module: 'ssl', service: 'soc:U', note: 'ssl embarque le client de soc:U (initialisation lue ; les envois ne sont pas suivis).' },
  { module: 'ssl', service: 'fs:USER', note: 'ssl lit son certificat client par défaut (archive ClCertA:).' },
  // cecd.md, carte d'identité (exheader et chaînes du code).
  { module: 'cecd', service: 'fs:USER', note: 'cecd tient les boîtes aux lettres dans l\'archive data:/CEC.' },
  { module: 'cecd', service: 'ptm:s', note: 'cecd ouvre ptm:s (chaîne dans le code).' },
  { module: 'cecd', service: 'ps:ps', note: 'cecd ouvre ps:ps (chaîne dans le code).' },
  { module: 'cecd', service: 'cfg:s', note: 'cecd ouvre cfg:s (chaîne dans le code).' },
  // nwm.md, ligne 16 : les quatre services de l'exheader. Les deux premiers ne sont pas vus ouverts par le code (seule la chaîne mcu::NWM est lue).
  { module: 'nwm', service: 'cfg:u', text: EXHEADER_TEXT, note: 'nwm déclare cfg:u dans son exheader ; ce qu\'il lui demande n\'est pas lu.' },
  { module: 'nwm', service: 'ps:ps', text: EXHEADER_TEXT, note: 'nwm déclare ps:ps dans son exheader ; ce qu\'il lui demande n\'est pas lu.' },
  { module: 'nwm', service: 'ptm:s', text: EXHEADER_TEXT, note: 'nwm déclare ptm:s dans son exheader ; ce qu\'il lui demande n\'est pas lu.' },
  // boss.md, ligne 16 : les neuf services de l'exheader (fs:USER est déjà dans la Carte, par 3dbrew). Des chaînes d'ouverture pour http:C, ptm:s, ptm:play et cecd:s ;
  // ac:u et frd:u sont déclarés sans chaîne d'ouverture ; cfg:s et ps:ps ne sont que dans l'exheader.
  { module: 'boss', service: 'http:C', note: 'boss ouvre http:C (chaîne à 0x144CBC) : ses téléchargements passent par lui.' },
  { module: 'boss', service: 'cecd:s', note: 'boss ouvre cecd:s (chaîne dans le code).' },
  { module: 'boss', service: 'ptm:s', note: 'boss ouvre ptm:s (chaîne dans le code).' },
  { module: 'boss', service: 'ptm:play', note: 'boss ouvre ptm:play (chaîne dans le code).' },
  { module: 'boss', service: 'ac:u', text: EXHEADER_TEXT, note: 'boss déclare ac:u dans son exheader ; le code n\'a pas de chaîne pour l\'ouvrir.' },
  { module: 'boss', service: 'frd:u', text: EXHEADER_TEXT, note: 'boss déclare frd:u dans son exheader ; le code n\'a pas de chaîne pour l\'ouvrir.' },
  { module: 'boss', service: 'cfg:s', text: EXHEADER_TEXT, note: 'boss déclare cfg:s dans son exheader ; ce qu\'il lui demande n\'est pas lu.' },
  { module: 'boss', service: 'ps:ps', text: EXHEADER_TEXT, note: 'boss déclare ps:ps dans son exheader ; ce qu\'il lui demande n\'est pas lu.' }
];
const CALL_TEXT = 'Lien lu dans le code : le module ouvre cette session.';

/* Liens que 3dbrew donne et que le code ne montre pas : ils restent, avec ce que dit le code. */
const CALL_NOTES = [
  // ptm.md, lignes 98 et 525.
  { module: 'ptm', service: 'ns:p', seen: { module: 'ptm',
    text: 'Le code de ptm n\'ouvre pas ns:p : l\'exheader autorise six noms (mcu::RTC, fs:USER, cfg:s, pxi:mc, pm:app, pdn:s) et ce sont les six que le code ouvre. Il apprend l\'état du couvercle par les notifications 0x213 et 0x214.' } },
  // ns.md, ligne 624.
  { module: 'ns', service: 'am:sys', seen: { module: 'ns',
    text: 'Le code de ns ouvre la session d\'am sous le nom am:u (chaîne à 0x120308), celui que l\'exheader autorise.' } },
  // nwm.md, ligne 16.
  { module: 'nwm', service: 'gpio:NWM', seen: { module: 'nwm',
    text: 'L\'exheader de nwm ne déclare pas gpio:NWM : il autorise cfg:u, mcu::NWM, ps:ps et ptm:s.' } },
  { module: 'nwm', service: 'cfg:s', seen: { module: 'nwm',
    text: 'L\'exheader de nwm ne déclare pas cfg:s : il autorise cfg:u, mcu::NWM, ps:ps et ptm:s.' } },
  { module: 'nwm', service: 'mcu::NWM', seen: { module: 'nwm',
    text: 'Confirmé par l\'exheader de nwm ; la chaîne mcu::NWM est à 0x13D4F4 dans le code.' } },
  // boss.md, ligne 16.
  { module: 'boss', service: 'fs:USER', seen: { module: 'boss',
    text: 'Confirmé par l\'exheader de boss ; la chaîne fs:USER est à 0x144CA7 dans le code, et boss appelle CheckAuthorityToAccessExtSaveData.' } }
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

/* ------------------------------------------------------------ 8. les fiches du matériel (le 16 octobre 2026)
   gpio, pdn, i2c, spi, mcu, codec, csnd et ps : les modules qui pilotent les broches, les bus, le microcontrôleur, le
   codec, le son simple et les signatures. Leurs écarts s'ajoutent aux tableaux des parties 2 à 5 ci-dessus. Un nom de
   3dbrew reste en place ; un rôle déduit des décalages de registres est dit « interprété ». */

// Défaut d'extraction : la page de 3dbrew donne deux en-têtes à ReadSPI et à WriteSPI (cellule étendue sur deux lignes),
// la Carte n'avait gardé que le premier de chaque. codec.md, ligne 132 ; Codec_Services relu le 16 octobre 2026.
const ROWSPAN_ROWS = [
  { service: 'cdc:CHK', h: '0x000200C0', same: '0x000100C0' },
  { service: 'cdc:CHK', h: '0x000400C2', same: '0x000300C2' }
];

// gpio.md, lignes 54 à 77, 200 et 201. Les sept services ont les mêmes commandes et chacun sa permission (ligne 40 à 48).
const GPIO_PERMISSIONS = { 'gpio:CDC': '0x00048', 'gpio:MCU': '0x48020', 'gpio:HID': '0x04301', 'gpio:NWM': '0x40020',
  'gpio:IR': '0x00EC0', 'gpio:NFC': '0x13000', 'gpio:QTM': '0x20000' };
const GPIO_FIELDS = [
  ['0x00010040', 'GetRegPart1', 'lit la direction des broches du masque (0 entrée, 1 sortie)', 'gpio_GetDirection, 0x101fe0'],
  ['0x00020080', 'SetRegPart1', 'écrit la direction des broches du masque', 'gpio_SetDirection, 0x10208c'],
  ['0x00030040', 'GetRegPart2', 'lit le front qui déclenche l\'interruption (0 descendant, 1 montant)', 'gpio_GetEdge, 0x1023bc'],
  ['0x00040080', 'SetRegPart2', 'écrit le front', 'gpio_SetEdge, 0x102468'],
  ['0x00050040', 'GetInterruptMask', 'lit l\'autorisation d\'interruption (1 autorisée)', 'gpio_GetInterruptEnable, 0x1024e8'],
  ['0x00060080', 'SetInterruptMask', 'écrit l\'autorisation d\'interruption', 'gpio_SetInterruptEnable, 0x102594']
];
for (const id of Object.keys(GPIO_PERMISSIONS)) {
  for (const [h, name, what, fn] of GPIO_FIELDS) {
    HEADER_NOTES.push({ service: id, h3dbrew: h, seen: { module: 'gpio',
      text: 'Le code ' + what + ' (' + fn + ') ; le nom ' + name + ' est celui de 3dbrew. Rôle déduit des décalages de registres (8, 16 et 24 dans 0x10147010, 16 dans 0x10147020 et 0x10147024) : interprété.' } });
  }
  SERVICE_NOTES.push({ services: [id], seen: { module: 'gpio',
    text: 'Une session au plus. Le code teste mask & ~permission, la permission de ce service valant ' + GPIO_PERMISSIONS[id] + ' : un bit du masque hors de la permission rend 0xE0E033EA (3dbrew : le masque est comparé à la permission, et une erreur est rendue si le résultat est non nul). Les commandes 1 à 6 refusent en plus les bits 0, 1, 2, 5 et 18 et plus (mask & 0xFFFC0027, résultat 0xE0E033FA). Seules les commandes 9 et 10 comparent l\'en-tête entier.' } });
}

// i2c.md, lignes 70, 73 et 169. La page de chaque commande sur 3dbrew (relue le 16 octobre 2026) donne déjà u16 pour le
// registre ; ce que la Carte avait gardé, c'est la signature u8 regid de la table des services.
for (const id of ['i2c::MCU', 'i2c::CAM', 'i2c::LCD', 'i2c::DEB', 'i2c::HID', 'i2c::IR', 'i2c::EEP', 'i2c::NFC', 'i2c::QTM']) {
  HEADER_NOTES.push({ service: id, h3dbrew: '0x000700C0', seen: { module: 'i2c',
    text: 'Le registre est de 16 bits : le code lit un mot de 16 bits au mot 2 de la requête et envoie deux octets de registre, le poids fort d\'abord (i2c_WriteRegister16, 0x103984). La note de la Carte (u8 regid) est celle de la table des services.' } });
  HEADER_NOTES.push({ service: id, h3dbrew: '0x000A0080', seen: { module: 'i2c',
    text: 'Le registre est de 16 bits, comme pour la commande 7 ; le code rend 0 et, au mot 2, la valeur de 16 bits, ou 0xFFFF si le transfert échoue (i2c_ReadRegister16, 0x103828). La note de la Carte (u8 regid) est celle de la table des services.' } });
}

// spi.md, lignes 50 à 62 et 68. Le nom « ReadWriteDevice2 » est celui de 3dbrew.
const SPI_SERVICES = ['SPI::NOR', 'SPI::CD2', 'SPI::CS2', 'SPI::CS3', 'SPI::DEF'];
for (const id of SPI_SERVICES) {
  HEADER_NOTES.push({ service: id, h3dbrew: '0x00040500', seen: { module: 'spi',
    text: 'Le code écrit deux tampons à la suite sous la même sélection, au plus 4 octets puis au plus 0x40 octets, et ne lit rien (spi_ReadWriteDevice2, 0x10153c) : le nom ReadWriteDevice2 est celui de 3dbrew. Il ne compare pas l\'en-tête entier.' } });
  HEADER_NOTES.push({ service: id, h3dbrew: '0x00070102', seen: { module: 'spi',
    text: 'Comme la commande 4, deux écritures à la suite, mais le second tampon est un tampon du client que le module lit (spi_ReadWriteDevice2Array, 0x10141c). Le code compare l\'en-tête entier.' } });
  HEADER_NOTES.push({ service: id, h3dbrew: '0x00060102', seen: { module: 'spi',
    text: 'Le code compare l\'en-tête entier (spi_ReadWriteDeviceArray, 0x10143c) : comme la commande 3, mais les octets lus vont dans un tampon du client.' } });
  SERVICE_NOTES.push({ services: [id], seen: { module: 'spi',
    text: 'Le module accepte les 9 commandes de 3dbrew, une session au plus par service et 5 en tout ; il ne distingue pas les services pour les commandes (tout client peut parler aux appareils 0 à 6). Seules les commandes 6 et 7 comparent l\'en-tête entier ; les sept autres se reconnaissent au numéro. La commande 2 ne fait rien et rend 0.' } });
}
// Les en-têtes que 3dbrew laisse incomplets, sur les quatre services que spi sert sans que le code lu les appelle (spi.md, lignes 56, 57 et 60).
PARTIAL_NOTES.push(
  { services: ['SPI::CD2', 'SPI::CS2', 'SPI::CS3', 'SPI::DEF'], id: '0x0001', seen: { module: 'spi',
    text: 'Le code ne regarde que le numéro et répond 0x00010040 : il range l\'octet d\'état (mot 2) dans la table des appareils (spi_SetDeviceState, 0x1012e8).' } },
  { services: ['SPI::CD2', 'SPI::CS2', 'SPI::CS3', 'SPI::DEF'], id: '0x0002', seen: { module: 'spi',
    text: 'Le code ne regarde que le numéro, ne fait rien et répond 0x00020040 (conforme à 3dbrew).' } },
  { services: ['SPI::CD2', 'SPI::CS2', 'SPI::CS3', 'SPI::DEF'], id: '0x0005', seen: { module: 'spi',
    text: 'Le code ne regarde que le numéro et répond 0x00050040 : il écrit au plus 4 octets (mot 2 ; mot 3 : leur nombre) (spi_WriteDevice, 0x101308).' } });
// Sur SPI::NOR ces trois en-têtes sont complétés par cfg ; le code de spi, lui, ne regarde que le numéro.
HEADER_NOTES.push(
  { service: 'SPI::NOR', h3dbrew: '0x00010080', seen: { module: 'spi',
    text: 'Côté spi, le code ne regarde que le numéro et range l\'octet d\'état (mot 2) dans la table des appareils (spi_SetDeviceState, 0x1012e8).' } },
  { service: 'SPI::NOR', h3dbrew: '0x00020040', seen: { module: 'spi',
    text: 'Côté spi, le code ne regarde que le numéro, ne fait rien et répond 0x00020040.' } },
  { service: 'SPI::NOR', h3dbrew: '0x000500C0', seen: { module: 'spi',
    text: 'Côté spi, le code ne regarde que le numéro et écrit au plus 4 octets (spi_WriteDevice, 0x101308).' } });

// pdn.md, lignes 49, 63 et 139. Aucune des cinq fonctions ne vérifie l'en-tête entier.
const PDN_DISPATCH = { 'pdn:s': '0x101bfc', 'pdn:d': '0x101aac', 'pdn:i': '0x101b74', 'pdn:g': '0x101b10', 'pdn:c': '0x101cb8' };
const PDN_EXTRA = {
  'pdn:d': ' La commande 1 refuse deassert vrai avec enable faux, par 0xE0E02401.',
  'pdn:g': ' La commande 1 refuse (resetEngines | resetRegisters) & ~clock non nul avec 0xE0E02401.'
};
for (const id of Object.keys(PDN_DISPATCH)) {
  SERVICE_NOTES.push({ services: [id], seen: { module: 'pdn',
    text: 'Une session au plus. Le code ne regarde que le numéro de la commande, jamais l\'en-tête entier (' + PDN_DISPATCH[id] + ').' + (PDN_EXTRA[id] || '') } });
}
PARTIAL_NOTES.push({ services: ['pdn:c'], id: '0x0002', seen: { module: 'pdn',
  text: '3dbrew écrit cet en-tête 0x000200000, avec un zéro de trop. Le code ne regarde que le numéro et répond 0x00020080 : il rend 0 et, au mot 2, le bit 0 de PDN_CAMERA_CNT (0x10141224).' } });

// mcu.md, ligne 276 : mcu::HID 6 ; lignes 96 à 106, 150, 168, 214, 270 et 281 : les commandes sans nom.
HEADER_NOTES.push({ service: 'mcu::HID', h3dbrew: '0x00060000', seen: { module: 'mcu',
  text: 'Le code lit les six octets des registres 0x45 à 0x4A et décale chaque mot de 16 bits de 4 : trois valeurs de 12 bits, que hid range dans la section de l\'accéléromètre (mcu_ReadGyroscopeValues, 0x106ec8). Le nom est celui de 3dbrew ; le sens est celui de l\'accéléromètre (interprété).' } });
const MCU_UNNAMED = [
  ['mcu::HID', '0x00010040', 'change le bit 0 du registre 0x40 du microcontrôleur (mcu_SetRegister40Bit0, 0x107464).'],
  ['mcu::HID', '0x00020000', 'lit le registre 0x40 (mcu_GetRegister40Bit0, 0x1073c4).'],
  ['mcu::HID', '0x00030040', 'écrit le registre 0x41 (mcu_WriteRegister41h, 0x1031a8).'],
  ['mcu::HID', '0x00040000', 'lit le registre 0x44 (mcu_ReadRegister44h, 0x103198).'],
  ['mcu::HID', '0x00050080', 'écrit les registres 0x43 et 0x44 (mcu_WriteRegisters43h44h, 0x103178).'],
  ['mcu::HID', '0x00080040', 'écrit, par la paire de registres 0x43 et 0x44, les bits 4 et 5 du registre interne 0x23 (mcu_SetAccelRegister23h, 0x1074fc). Accès indirect à un registre de l\'accéléromètre : interprété.'],
  ['mcu::HID', '0x00090000', 'lit, par la paire de registres 0x43 et 0x44, les bits 4 et 5 du registre interne 0x23 (mcu_GetAccelRegister23h, 0x1074ac). Accès indirect à un registre de l\'accéléromètre : interprété.'],
  ['mcu::HID', '0x000A0040', 'écrit, par la paire de registres 0x43 et 0x44, le bit 4 du registre interne 0x21 (mcu_SetAccelRegister21hBit4, 0x102e2c). Accès indirect à un registre de l\'accéléromètre : interprété.'],
  ['mcu::HID', '0x000B0000', 'lit, par la paire de registres 0x43 et 0x44, le bit 4 du registre interne 0x21 (mcu_GetAccelRegister21hBit4, 0x107908). Accès indirect à un registre de l\'accéléromètre : interprété.'],
  ['mcu::SND', '0x00020040', 'change les six bits du bas du registre 0x25 (mcu_SetRegister25hBits, 0x107664).'],
  ['mcu::CDC', '0x00010000', 'change le bit 4 du registre 0x26 (mcu_SetRegister26hBit4, 0x107700) ; codec l\'envoie après l\'initialisation de la puce.'],
  ['mcu::RTC', '0x00230000', 'écrit 1 dans le registre 0x4E (mcu_WriteRegister4Eh, 0x1073b0).'],
  ['mcu::RTC', '0x00350000', 'écrit 0x10 dans le registre 0x20 (mcu_WriteRegister20_bit4, 0x106f08).']
];
for (const [service, h, what] of MCU_UNNAMED) {
  HEADER_NOTES.push({ service, h3dbrew: h, seen: { module: 'mcu', text: 'Sans nom sur 3dbrew. Le code ' + what } });
}
// Les douze commandes 81 à 92 de mcu::RTC (aiguillage 0x10498c) : 3dbrew les nomme sans dire quel registre elles touchent.
for (const h of ['0x00510040', '0x00520000', '0x00530040', '0x00540000', '0x00550040', '0x00560000', '0x00570040', '0x00580000',
  '0x00590040', '0x005A0000', '0x005B0040', '0x005C0000']) {
  HEADER_NOTES.push({ service: 'mcu::RTC', h3dbrew: h, seen: { module: 'mcu',
    text: '3dbrew ne dit pas quel registre cette commande touche. Le code la traite dans l\'aiguillage (0x10498c) : une banque de 16 octets de registres libres du microcontrôleur, dont l\'indice va dans le registre 0x60 et la valeur dans le registre 0x61 ; chaque commande a son indice.' } });
}
// mcu.md, lignes 221 à 228 et 420 : mcu::NWM, dont la Carte n'a que les numéros.
PARTIAL_NOTES.push(
  { services: ['mcu::NWM'], id: '0x0003', seen: { module: 'mcu',
    text: 'Le code ne regarde que le numéro et appelle GPIOMCU_SetData de gpio:MCU (0x104284) ; le masque vient de la requête, non lu. 3dbrew écrit « GPIO 0x20 ».' } },
  { services: ['mcu::NWM'], id: '0x0004', seen: { module: 'mcu',
    text: 'Le code ne regarde que le numéro et appelle GPIOMCU_GetData de gpio:MCU (0x104354) ; le masque vient de la requête, non lu. 3dbrew écrit « GPIO 0x20 ».' } },
  { services: ['mcu::NWM'], id: '0x0005', seen: { module: 'mcu',
    text: 'Le code ne regarde que le numéro : il règle la direction puis le niveau de la broche 0x40000 de gpio:MCU (WiFi activé, d\'après la fiche de gpio).' } },
  { services: ['mcu::NWM'], id: '0x0006', seen: { module: 'mcu',
    text: 'Le code ne regarde que le numéro : il règle la direction puis lit le niveau de la broche 0x40000 de gpio:MCU (WiFi activé, d\'après la fiche de gpio).' } },
  { services: ['mcu::NWM'], id: '0x0007', seen: { module: 'mcu',
    text: 'Le code ne regarde que le numéro et passe par la banque de registres libres (registres 0x60 et 0x61).' } },
  { services: ['mcu::NWM'], id: '0x0008', seen: { module: 'mcu',
    text: 'Le code ne regarde que le numéro et passe par la banque de registres libres (registres 0x60 et 0x61).' } });
// mcu.md, lignes 64, 305 à 317 : nombres de commandes (comme la Carte) et en-têtes entiers.
const MCU_COUNTS = [['mcu::CAM', '0x0002', 2], ['mcu::GPU', '0x000E', 14], ['mcu::HID', '0x000F', 15], ['mcu::SND', '0x0003', 3],
  ['mcu::NWM', '0x0008', 8], ['mcu::PLS', '0x0009', 9], ['mcu::CDC', '0x0001', 1]];
for (const [id, last, n] of MCU_COUNTS) {
  SERVICE_NOTES.push({ services: [id], seen: { module: 'mcu',
    text: 'Le module accepte ' + n + ' commande' + (n > 1 ? 's' : '') + ', 0x0001 à ' + last + ' (comme la Carte), une session au plus. Seul le numéro compte dans l\'en-tête.' } });
}
SERVICE_NOTES.push(
  { services: ['mcu::RTC'], seen: { module: 'mcu',
    text: 'Le module accepte 92 commandes, 0x0001 à 0x005C (comme la Carte), une session au plus. Seul le numéro compte dans l\'en-tête, sauf pour les commandes 34 et 56 à 58, dont l\'en-tête entier est comparé.' } },
  { services: ['mcu::HWC'], seen: { module: 'mcu',
    text: 'Le module accepte 17 commandes, 0x0001 à 0x0011 (comme la Carte), une session au plus. Seul le numéro compte dans l\'en-tête, sauf pour les commandes 1 à 3, dont l\'en-tête entier est comparé.' } });
// mcu.md, lignes 300 à 317 : les notifications publiées. La Carte n'a pas de table des notifications ; la commande de srv: est le lien.
HEADER_NOTES.push({ service: 'srv:', h3dbrew: '0x000C0080', seen: { module: 'mcu',
  text: 'mcu l\'envoie pour publier onze notifications : 0x200 (couvercle), 0x202 à 0x206 (boutons POWER et HOME, commutateur WiFi) et 0x20C à 0x210 (chien de garde, chargeur, batterie), par SRV_PublishToSubscriber (0x101934). Il ne publie ni 0x213 ni 0x214 (couvercle ouvert et fermé), que reçoivent ptm, hid et gsp : leur éditeur reste inconnu.' } });

// codec.md, lignes 49, 53 à 63, 120 à 132 et 190 à 194. 3dbrew donne les en-têtes de cdc:HID ; le code ne regarde que le numéro.
SERVICE_NOTES.push(
  { services: ['cdc:HID'], seen: { module: 'codec',
    text: 'Le module accepte les 3 commandes de 3dbrew, une session au plus. Il ne regarde que le numéro de la requête (hid envoie 0x00010000 et 0x00020000, voir les notes des commandes) et répond 0x000100C0 pour GetData (le résultat puis deux mots, interprété), 0x00020040 pour Initialize et 0x00030040 pour Finalize (cdchid_GetData, 0x105bf0 ; cdchid_Initialize, 0x105b84 ; cdchid_Finalize, 0x106298). Les en-têtes 0x00010042, 0x00020042 et 0x00030000 de 3dbrew sont ceux de requêtes : ils ne sont pas à comparer à ces réponses.' } },
  { services: ['cdc:MIC'], seen: { module: 'codec',
    text: 'Le module accepte les 5 commandes de 3dbrew, une session au plus. Ce sont celles que mic envoie.' } },
  { services: ['cdc:CSN'], seen: { module: 'codec',
    text: 'Le module accepte 9 commandes (comme la Carte, qui ne les nomme pas), une session au plus : les accès à la puce vont de la sortie du son à l\'événement de réveil (commande 9). Aucun nom n\'est connu ; les rôles lus sont interprétés (voir la fiche).' } },
  { services: ['cdc:DSP'], seen: { module: 'codec',
    text: 'Le module accepte 8 commandes (comme la Carte, qui ne les nomme pas), une session au plus. L\'en-tête entier est comparé pour les commandes 1, 2, 3 et 5 ; les noms viennent de la fiche de dsp.' } },
  { services: ['cdc:LGY'], seen: { module: 'codec',
    text: 'Le module accepte les 3 commandes de 3dbrew, une session au plus.' } },
  { services: ['cdc:CHK'], seen: { module: 'codec',
    text: 'Le module accepte 7 commandes, 0x0001 à 0x0007, une session au plus ; 3dbrew en donne 4 (ReadSPI et WriteSPI, chacune sous deux en-têtes). Les commandes 1 à 4 choisissent une banque de la puce puis lisent (1, 2) ou écrivent (3, 4) des registres ; la 5 lit et la 6 écrit un registre de l\'appareil SPI 0 ; la 7 est la commande 3 de cdc:CSN. L\'en-tête entier est comparé pour les commandes 3 et 4.' } });

// ps.md, lignes 15, 31 à 49 et 88 à 91.
SERVICE_NOTES.push({ services: ['ps:ps'], seen: { module: 'ps',
  text: 'Le module accepte 17 commandes, 0x0001 à 0x0011, sur 9 sessions au plus. La commande 3 (SetAesKey), que 3dbrew donne sans en-tête et que la Carte ne liste donc pas, rend 0xD8C107F4 sans rien faire : conforme à 3dbrew. L\'en-tête entier est comparé pour les commandes 1, 2, 4, 5 et 13 à 17.' } });
HEADER_NOTES.push(
  { service: 'ps:ps', h3dbrew: '0x000E0082', seen: { module: 'ps',
    text: 'Le code rend au plus 0x20 octets dans un tampon statique (ps_cmd000E, 0x102c18) ; la page de 3dbrew ne donne pas cette taille. Le module accepte la commande sur toutes les consoles ; sur une Old 3DS, c\'est Process9 qui répond « en-tête invalide ».' } },
  { service: 'ps:ps', h3dbrew: '0x00100042', seen: { module: 'ps',
    text: 'Le code rend au plus 0x400 octets (ps_cmd0010, 0x102e6c) ; la page de 3dbrew ne donne pas cette taille.' } },
  { service: 'ps:ps', h3dbrew: '0x00110042', seen: { module: 'ps',
    text: 'Le code rend au plus 0x400 octets (ps_cmd0011, 0x102aa4) ; la page de 3dbrew ne donne pas cette taille.' } });

// csnd.md, lignes 15, 34 et 36.
SERVICE_NOTES.push({ services: ['csnd:SND'], seen: { module: 'csnd',
  text: 'Le module accepte les 12 commandes de 3dbrew, sur 4 sessions au plus (un fil par session). L\'en-tête entier est comparé pour les commandes 9, 10 et 11 ; pour les autres, seul le numéro compte.' } });

// Services appelés : mcu.md ligne 18 ; codec.md ligne 15 et partie 8 ; ps.md ligne 16 ; csnd.md lignes 16 et 25.
CALLS.push(
  { module: 'mcu', service: 'ptm:s', text: EXHEADER_TEXT, note: 'mcu déclare ptm:s dans son exheader ; le code n\'a pas de chaîne pour l\'ouvrir.' },
  { module: 'codec', service: 'gpio:CDC', note: 'codec règle la broche du casque, l\'autorise, la lie à un événement et en lit le niveau.' },
  { module: 'codec', service: 'mcu::CDC', note: 'codec demande à mcu de mettre à 1 le bit 4 du registre 0x26 du microcontrôleur.' },
  { module: 'codec', service: 'cfg:s', note: 'codec lit le bloc de configuration 0x00020000 (étalonnage d\'usine, 0x134 octets) et le modèle de la console.' },
  { module: 'codec', service: 'ptm:s', note: 'codec demande si la console est une New 3DS et accuse réception de la veille et du réveil ; il ouvre la session sous le nom ptm:s (table de noms à 0x108080).' },
  { module: 'ps', service: 'mcu::PLS', note: 'ps lit l\'heure (commande 1) et le compteur de ticks (commande 9) du microcontrôleur pour alimenter le générateur d\'aléa.' },
  { module: 'csnd', service: 'ptm:s', note: 'csnd accuse réception de la veille à ptm ; il ouvre la session sous le nom ptm:s.' });

/* ------------------------------------------------------------ 9. les fiches des applications et du réseau (le 17 octobre 2026)
   am, news, act, dlp, mp, nfc, mvd, nim et qtm. Chaque table de commandes a été rejouée par emulate_dispatch.py ; elle est
   « sûre » quand la Carte la confirme, « interprétée » quand la Carte ne la connaît pas ou que l'aiguillage n'est rattaché à
   son service que par élimination. Un lien vers un service est « lu dans le code » quand la fiche montre la fonction qui
   l'ouvre, une référence du code à son nom ou une chaîne propre au module ; un nom qui n'est que dans l'exheader ou dans la
   liste de noms de la bibliothèque commune (celle qui porte aussi fs:LDR et srv:pm) reste « lu dans l'exheader ». */
const URL_ACTU = 'https://www.3dbrew.org/wiki/ACT_Services#ACT_service_"act:u"';
const URL_NFCM = 'https://www.3dbrew.org/wiki/NFC_Services#NFC_management_service_"nfc:m"';

// am.md, lignes 48 à 55 (tables émulées), 25 (am:pipe), 211 (Verify) et 253 (relais vers pxi:am9).
SERVICE_NOTES.push(
  { services: ['am:app'], seen: { module: 'am',
    text: 'Le module accepte les 13 commandes de 3dbrew (aiguillage 0x105008, un fil par session). Elles sont aussi acceptées par am:sys, am:u et am:net, aux mêmes adresses.' } },
  { services: ['am:sys'], seen: { module: 'am',
    text: 'Le module accepte 58 commandes, comme la Carte : 0x0001 à 0x002D et les 13 de am:app (aiguillage 0x103DE8).' } },
  { services: ['am:u'], seen: { module: 'am',
    text: 'Le module accepte 83 commandes, pas 70 : celles de am:sys (y compris les 13 de am:app, 0x1001 à 0x100D) plus 0x0401 à 0x0419 (aiguillage 0x105540). 3dbrew écrit que seul am:sys a accès aux commandes de am:app ; le code les accepte aussi ici.' } },
  { services: ['am:net'], seen: { module: 'am',
    text: 'Le module accepte 124 commandes, pas 111 : celles de am:u (y compris les 13 de am:app, 0x1001 à 0x100D) plus 0x0801 à 0x0829 (aiguillage 0x10AA54).' } },
  { services: ['am:pipe'], seen: { module: 'am',
    text: 'Le port existe mais n\'est pas enregistré sous ce nom : am le crée par CreatePort sans nom (svc 0x47, 0x110F18), conforme à 3dbrew (« la chaîne am:pipe n\'est pas utilisée »). Ses commandes ne sont pas lues.' } },
  { services: ['pxi:am9'], seen: { module: 'am',
    text: 'am relaie presque toutes ses commandes à pxi:am9 : 88 commandes distinctes fabriquées par ses gestionnaires, dont 38 ont leur en-tête entier vérifié par l\'aiguillage de Process9 ; aucune ne diverge.' } });
HEADER_NOTES.push({ service: 'am:net', h3dbrew: '0x08170146', seen: { module: 'am',
  text: 'Commande non implémentée : le gestionnaire (0x103C10) tient en deux instructions et rend 0xF8C083F4. 3dbrew ne le signale pas.' } });

// news.md, lignes 15, 38 à 40, 57, 58 et 80 ; 82 et 93 pour la diode.
SERVICE_NOTES.push(
  { services: ['news:u'], seen: { module: 'news',
    text: 'Le module accepte 1 commande, sur 1 session au plus (table 0x10A4F4). L\'en-tête 0x000100C8 porte le numéro de processus de l\'appelant, que news change en identifiant de titre ; news:s reçoit l\'identité dans la requête (0x000100C6).' } },
  { services: ['news:s'], seen: { module: 'news',
    text: 'Le module accepte 20 commandes, 0x0001 à 0x0014, sur 2 sessions au plus ; les 18 que 3dbrew nomme ont exactement ces en-têtes quand le code les vérifie (aiguillage 0x1079D0).' } });
for (const id of ['0x0002', '0x0003']) {
  PARTIAL_NOTES.push({ services: ['news:s'], id, seen: { module: 'news',
    text: 'Le code ne regarde que le numéro, ne lit aucun paramètre et répond ' + id + '0040 avec un résultat nul (cas écrit dans l\'aiguillage 0x1079D0) : conforme à 3dbrew.' } });
}
CALL_NOTES.push({ module: 'news', service: 'ptm:sysm', seen: { module: 'news',
  text: 'Confirmé : news envoie SetInfoLEDPattern à ptm:sysm (0x104E48), pour news:s 0x000E et à la fin d\'AddNotification ; ptm:sysm est dans son exheader.' } });

// act.md, lignes 15, 26, 39 à 42, 61, 82 à 85, 182 et 183. 3dbrew, relu le 17 octobre 2026, a depuis ajouté 0x20 à 0x22
// avec les mêmes en-têtes et donne 0x000A0000 SetIsApplicationUpdateRequired ; la Carte a été tirée d'une version plus ancienne.
for (const service of ['act:u', 'act:a']) {
  HEADER_NOTES.push({ service, h3dbrew: '0x001F0082', seen: { module: 'act', h: '0x001F0042',
    text: 'L\'aiguillage n\'accepte que 0x001F0042 (un mot ordinaire, un descripteur) et répond 0x001F0040 (act_cmd_001F_AcquireEulaLanguageList, 0x10FEE4). 3dbrew, relu le 17 octobre 2026, donne toujours 0x001F0082.' } });
  PARTIAL_NOTES.push({ services: [service], id: '0x000A', seen: { module: 'act',
    text: 'Le code ne regarde que le numéro et répond 0x000A0040 (act_cmd_000A_Unknown, 0x110FE8). 3dbrew, relu le 17 octobre 2026, la donne avec l\'en-tête 0x000A0000 sous le nom SetIsApplicationUpdateRequired.' } });
  for (const [h, name, reply, fn] of [['0x00200382', 'AcquireIndependentServiceTokenV2', '0x00200040', 'act_cmd_0020_Unknown, 0x10FDC0'],
    ['0x00210002', 'GetIndepdendentServiceTokenV2', '0x00210042', 'act_cmd_0021_Unknown, 0x10FD6C'],
    ['0x00220342', 'GetCachedIndependentServiceTokenV2', '0x00220042', 'act_cmd_0022_Unknown, 0x10FC68']]) {
    COMPLETED_HEADERS.push({ service, id: h.slice(0, 6), h, n: name, add: true, url: URL_ACTU, seen: { module: 'act',
      text: 'Absente de la Carte, qui s\'arrête à 0x001F. Le module l\'accepte avec l\'en-tête entier ' + h + ' et répond ' + reply + ' (' + fn + ') ; ce qu\'elle fait n\'est pas lu. 3dbrew, relu le 17 octobre 2026, la donne avec le même en-tête et ce nom.' } });
  }
}
SERVICE_NOTES.push(
  { services: ['act:u'], seen: { module: 'act',
    text: 'Le module accepte 34 commandes, 0x0001 à 0x0022 (aiguillage 0x10A898), sur 3 sessions au plus, et 6 sessions en tout pour act:u et act:a.' } },
  { services: ['act:a'], seen: { module: 'act',
    text: 'Le module accepte 87 commandes : les 34 de act:u, aux mêmes adresses, plus 0x0401 à 0x0435 (aiguillage 0x10B20C) ; 3 sessions au plus.' } });

// dlp.md, lignes 15, 16, 42, 44, 100, 115, 116 et 121.
SERVICE_NOTES.push(
  { services: ['dlp:CLNT'], seen: { module: 'dlp',
    text: 'Le module accepte les 20 commandes de 3dbrew, sur 1 session au plus, servie par son propre fil (aiguillage 0x10B8E0). Les commandes de recherche (GetEventDesc, StartScan, GetServerInfo...) ont les mêmes gestionnaires que celles de dlp:FKCL.' } },
  { services: ['dlp:SRVR'], seen: { module: 'dlp',
    text: 'Le module accepte les 16 commandes de 3dbrew, sur 1 session au plus (aiguillage 0x10BC6C).' } },
  { services: ['dlp:FKCL'], seen: { module: 'dlp',
    text: 'Le module accepte les 17 commandes de 3dbrew, sur 1 session au plus (aiguillage 0x10C058).' } });
HEADER_NOTES.push(
  { service: 'dlp:FKCL', h3dbrew: '0x00100000', seen: { module: 'dlp',
    text: 'Confirmé : même gestionnaire que StopSession de dlp:CLNT (0x107F18), réponse 0x00100040.' } },
  { service: 'dlp:FKCL', h3dbrew: '0x00110203', seen: { module: 'dlp',
    text: 'Le cas de l\'aiguillage appelle la même fonction qu\'Initialize (0x1078AC) : lu dans le pseudo-code, l\'émulation refusant la requête (interprété).' } },
  { service: 'dlp:SRVR', h3dbrew: '0x000F0303', seen: { module: 'dlp',
    text: 'Le cas de l\'aiguillage appelle la même fonction qu\'Initialize (0x104F5C) ; l\'en-tête seul les distingue. Lu dans le pseudo-code, l\'émulation refusant la requête (interprété).' } });

// mp.md, lignes 15, 36 et 70 à 72.
SERVICE_NOTES.push({ services: ['mp:u'], seen: { module: 'mp',
  text: 'Le module accepte les 20 commandes de 3dbrew, sur 1 session au plus (aiguillage ARM 0x11D1DC). Bind refuse un nœud au-delà de 15, RecvDataFrame rend une trame d\'au plus 700 octets, SetBeaconData et SetAppData refusent plus de 0x70 octets.' } });

// nfc.md, lignes 15, 41 à 48, 284 à 304, 309 à 312 et 347 à 352. 3dbrew, relu le 17 octobre 2026, n'a aucune des
// commandes 0x0409 à 0x040B ni 0x0410 à 0x0415, et dit « une seule session pour tous ces services ensemble ».
for (const [h, reply, fn] of [['0x04090042', '0x04090040', 'nfc_m_cmd_0409_Unknown, 0x124BF4'], ['0x040A0042', '0x040A03C0', 'nfc_m_cmd_040A_Unknown, 0x124CE4'],
  ['0x040B00C2', '0x040B0042', 'nfc_m_cmd_040B_Unknown, 0x124C9C'], ['0x04120042', '0x04120040', 'nfc_m_cmd_0412_Unknown, 0x124D9C'],
  ['0x04140042', '0x04140040', 'nfc_m_cmd_0414_Unknown, 0x124C44']]) {
  COMPLETED_HEADERS.push({ service: 'nfc:m', id: h.slice(0, 6), h, n: UNNAMED, add: true, url: URL_NFCM, seen: { module: 'nfc',
    text: 'Absente de 3dbrew. Le module l\'accepte avec l\'en-tête entier ' + h + ' et répond ' + reply + ' (' + fn + ') ; ce qu\'elle fait n\'est pas lu.' } });
}
SERVICE_NOTES.push(
  { services: ['nfc:u'], seen: { module: 'nfc',
    text: 'Le module accepte 34 commandes, 0x0001 à 0x0022 (aiguillage 0x12954C), sur 1 session au plus : la Carte n\'a pas 0x000E, que le code accepte par le numéro seul et à laquelle il répond 0x000E0080 (0x1139D8 ; 3dbrew ne la donne que dans sa table d\'avant 9.3.0, 0x000E0000, sans nom). Initialize prend un mode 1, 2 ou 3 et refuse les autres.' } },
  { services: ['nfc:m'], seen: { module: 'nfc',
    text: 'Le module accepte 55 commandes (aiguillage 0x12A468), sur 1 session au plus : les 34 de nfc:u aux mêmes adresses, plus 0x0401 à 0x0415. 3dbrew n\'a ni 0x000E ni 0x0409 à 0x040B ni 0x0410 à 0x0415 ; 0x0410, 0x0411, 0x0413 et 0x0415 sont acceptées par le numéro seul (réponses 0x04100040, 0x04110042, 0x04130040, 0x04150040).' } },
  { services: ['nfc:p'], seen: { module: 'nfc',
    text: 'Le module accepte les 19 commandes de 3dbrew, sur 1 session au plus (aiguillage 0x12C1EC).' } },
  { services: ['nfc:s'], seen: { module: 'nfc',
    text: 'Le code a un aiguillage de 69 commandes, 0x0001 à 0x0045 sans trou (0x12AE00), quand 3dbrew en donne 3 ; 1 session au plus. Interprété : cet aiguillage est rattaché à nfc:s par son rang dans la table des services, la Carte ne pouvant pas le confirmer.' } },
  { services: ['nfc:r'], seen: { module: 'nfc',
    text: 'Le code a un aiguillage de 26 commandes, 0x0001 à 0x001A (0x129EA0), quand 3dbrew n\'en donne aucune ; 1 session au plus. Interprété : cet aiguillage est rattaché à nfc:r par son rang dans la table des services.' } },
  { services: ['nfc:dev'], seen: { module: 'nfc',
    text: 'Le code a un aiguillage de 19 commandes, 0x0001 à 0x0013 (0x129AF4), dont ReadRawPages (0x11) et WriteRawPage (0x12) ; 3dbrew n\'en donne que ces deux. 1 session au plus. Interprété : rattaché à nfc:dev par son rang dans la table des services.' } });

// mvd.md, lignes 15, 16, 26 et 39 à 43.
SERVICE_NOTES.push(
  { services: ['mvd:STD'], seen: { module: 'mvd',
    text: 'Le module accepte les 33 commandes de 3dbrew (aiguillage 0x1124E8), sur 1 session au plus, et 4 sessions en tout pour ses quatre services. Il n\'appelle aucun service : son exheader n\'en déclare aucun.' } },
  { services: ['y2r2:u'], seen: { module: 'mvd',
    text: 'Le module accepte les 45 commandes de 3dbrew (aiguillage 0x11328C), sur 1 session au plus. Ce convertisseur est servi par mvd, pas par camera.' } },
  ...['l2b:u', 'l2b2:u'].map(id => ({ services: [id], seen: { module: 'mvd',
    text: 'Le module accepte les 23 commandes de 3dbrew, sur 1 session au plus. l2b:u et l2b2:u partagent le même aiguillage (0x111E64, table 0x11A04C) : ce qui les distingue n\'est pas dans le code de l\'aiguillage.' } })));

// nim.md, lignes 27 à 36, 100, 145, 265 et 269 ; le nombre de sessions n'est pas lu (ligne 275).
SERVICE_NOTES.push(
  { services: ['nim:u'], seen: { module: 'nim',
    text: 'Le module accepte les 46 commandes de 3dbrew (aiguillage 0x107F78), avec les 12 en-têtes entiers qu\'il vérifie identiques ; un fil par session.' } },
  { services: ['nim:ndm'], seen: { module: 'nim',
    text: 'Le module accepte les 5 commandes de 3dbrew (aiguillage 0x105470), celles que ndm envoie ; les cinq gestionnaires se suivent de 0x10BFF8 à 0x10C038.' } },
  { services: ['nim:s'], seen: { module: 'nim',
    text: 'Le code a un aiguillage de 94 commandes, 0x0001 à 0x005F sauf 0x0004 (0x10557C), quand 3dbrew en donne 36 (et deux incomplètes). Interprété : rattaché à nim:s parce qu\'il retrouve ses 36 numéros, mais seulement 20 de ses en-têtes sur 52 comparés.' } },
  { services: ['nim:aoc'], seen: { module: 'nim',
    text: 'Le code a un aiguillage de 38 commandes, 0x0001 à 0x0026 (0x1039C4), quand 3dbrew en donne 8. Interprété : rattaché à nim:aoc par élimination (4 en-têtes égaux sur 27 comparés).' } });

// qtm.md, lignes 15, 16, 27 à 29 et 39 à 46.
SERVICE_NOTES.push(
  { services: ['qtm:u'], seen: { module: 'qtm',
    text: 'Le module accepte les 6 commandes de 3dbrew, sur 3 sessions au plus ; seul le numéro compte dans l\'en-tête. qtm:s et qtm:sp ont ces 6 commandes aux mêmes adresses. Interprété : l\'aiguillage 0x103464 est rattaché à qtm:u par son nombre de commandes.' } },
  { services: ['qtm:s'], seen: { module: 'qtm',
    text: 'Le module accepte les 16 commandes de 3dbrew, sur 3 sessions au plus ; seul le numéro compte dans l\'en-tête. Interprété : l\'aiguillage 0x1035C4 est rattaché à qtm:s par son nombre de commandes.' } },
  { services: ['qtm:sp'], seen: { module: 'qtm',
    text: 'Le module accepte les 20 commandes de 3dbrew : celles de qtm:s aux mêmes adresses, plus 0x0801 à 0x0804 ; 3 sessions au plus ; seul le numéro compte dans l\'en-tête. Interprété : l\'aiguillage 0x1039F8 est rattaché à qtm:sp par son nombre de commandes.' } },
  { services: ['qtm:c'], seen: { module: 'qtm',
    text: 'Le module accepte les 5 commandes de 3dbrew, sur 3 sessions au plus ; seul le numéro compte dans l\'en-tête. Interprété : l\'aiguillage 0x103918 est rattaché à qtm:c par son nombre de commandes.' } });

// Services appelés : la ligne « Services appelés » de chaque fiche (am.md 16, news.md 16, act.md 16, dlp.md 16, mp.md 16,
// nfc.md 16, nim.md 16, qtm.md 16). Les liens que la Carte a déjà par 3dbrew ne sont pas repris.
CALLS.push(
  { module: 'am', service: 'pxi:am9', note: 'am relaie presque toutes ses commandes à Process9 par pxi:am9, qu\'il ouvre au démarrage (am_connect_pxi_am9, 0x100534).' },
  { module: 'am', service: 'fs:USER', note: 'am ouvre fs:USER au démarrage (0x1005D8) ; ce qu\'il y lit n\'est pas suivi.' },
  { module: 'news', service: 'boss:P', note: 'news ouvre boss:P (chaîne à 0x102CFC) ; ce qu\'il lui demande n\'est pas suivi.' },
  { module: 'news', service: 'cecd:s', note: 'news ouvre cecd:s (chaîne à 0x102764) ; ce qu\'il lui demande n\'est pas suivi.' },
  { module: 'news', service: 'ndm:u', note: 'news ouvre ndm:u (chaîne à 0x104E04) ; ce qu\'il lui demande n\'est pas suivi.' },
  { module: 'news', service: 'nim:u', note: 'news ouvre nim:u (chaîne à 0x101304) ; ce qu\'il lui demande n\'est pas suivi.' },
  { module: 'news', service: 'fs:USER', note: 'news tient sa base de notifications dans l\'archive data: (chaîne fs:USER à 0x1058A0).' },
  { module: 'news', service: 'frd:u', text: EXHEADER_TEXT, note: 'news déclare frd:u dans son exheader ; le nom n\'est écrit nulle part dans le code.' },
  { module: 'act', service: 'am:net', note: 'act ouvre am:net (le code renvoie au nom à 0x101C6C) ; ce qu\'il lui demande n\'est pas suivi.' },
  { module: 'act', service: 'fs:USER', note: 'act tient ses comptes dans l\'archive data: (le code renvoie au nom fs:USER à 0x101280).' },
  { module: 'act', service: 'http:C', note: 'act parle au serveur de comptes par http:C (le code renvoie au nom à 0x101B10 et 0x121D0C).' },
  { module: 'act', service: 'cfg:s', text: EXHEADER_TEXT, note: 'act déclare cfg:s dans son exheader ; le nom n\'est que dans la liste de la bibliothèque commune.' },
  { module: 'act', service: 'frd:u', text: EXHEADER_TEXT, note: 'act déclare frd:u dans son exheader ; le nom n\'est écrit nulle part dans le code.' },
  { module: 'dlp', service: 'ps:ps', note: 'dlp ouvre ps:ps (chaîne à 0x11202A) ; ce qu\'il lui demande n\'est pas suivi.' },
  { module: 'dlp', service: 'nwm::UDS', text: EXHEADER_TEXT, note: 'dlp déclare nwm::UDS dans son exheader ; le nom est dans la liste de noms du module (0x1121CE), ses appels ne sont pas suivis.' },
  { module: 'dlp', service: 'am:u', text: EXHEADER_TEXT, note: 'dlp déclare am:u dans son exheader, pour installer le jeu reçu ; ses appels ne sont pas suivis.' },
  { module: 'dlp', service: 'fs:USER', text: EXHEADER_TEXT, note: 'dlp déclare fs:USER dans son exheader ; le nom est dans la liste de noms du module (0x112187).' },
  { module: 'dlp', service: 'cfg:u', text: EXHEADER_TEXT, note: 'dlp déclare cfg:u dans son exheader ; le nom n\'est que dans la liste de la bibliothèque commune.' },
  { module: 'dlp', service: 'ptm:s', text: EXHEADER_TEXT, note: 'dlp déclare ptm:s dans son exheader ; le nom n\'est que dans la liste de la bibliothèque commune.' },
  { module: 'mp', service: 'nwm::EXT', note: 'mp ouvre nwm::EXT (chaîne à 0x120070), pour l\'accès à la puce Wi-Fi (interprété).' },
  { module: 'mp', service: 'cfg:nor', text: EXHEADER_TEXT, note: 'mp déclare cfg:nor dans son exheader ; le nom n\'est que dans la liste de la bibliothèque commune.' },
  { module: 'mp', service: 'ptm:s', text: EXHEADER_TEXT, note: 'mp déclare ptm:s dans son exheader ; le nom n\'est que dans la liste de la bibliothèque commune.' },
  { module: 'nfc', service: 'ps:ps', note: 'nfc ouvre ps:ps (chaîne à 0x135560) ; ce qu\'il lui demande n\'est pas suivi.' },
  { module: 'nfc', service: 'nwm::EXT', text: EXHEADER_TEXT, note: 'nfc déclare nwm::EXT dans son exheader ; le nom est à 0x1360F0, près de la liste de la bibliothèque commune.' },
  { module: 'nfc', service: 'fs:USER', text: EXHEADER_TEXT, note: 'nfc déclare fs:USER dans son exheader, pour sa sauvegarde nfp_backup.dat ; ses appels ne sont pas suivis.' },
  { module: 'nfc', service: 'cfg:s', text: EXHEADER_TEXT, note: 'nfc déclare cfg:s dans son exheader ; ce qu\'il lui demande n\'est pas lu.' },
  { module: 'nfc', service: 'ptm:s', text: EXHEADER_TEXT, note: 'nfc déclare ptm:s dans son exheader ; ce qu\'il lui demande n\'est pas lu.' },
  { module: 'nim', service: 'am:net', note: 'nim ouvre am:net (chaîne à 0x151912) pour installer ce qu\'il télécharge ; ses appels ne sont pas suivis.' },
  { module: 'nim', service: 'fs:USER', note: 'nim tient sa base nimdb: (chaîne fs:USER à 0x1519CF).' },
  { module: 'nim', service: 'ac:u', text: EXHEADER_TEXT, note: 'nim déclare ac:u dans son exheader ; ce qu\'il lui demande n\'est pas lu.' },
  { module: 'nim', service: 'ptm:s', text: EXHEADER_TEXT, note: 'nim déclare ptm:s dans son exheader ; ce qu\'il lui demande n\'est pas lu.' },
  { module: 'nim', service: 'ptm:gets', text: EXHEADER_TEXT, note: 'nim déclare ptm:gets dans son exheader ; ce qu\'il lui demande n\'est pas lu.' },
  { module: 'qtm', service: 'cam:q', note: 'qtm ouvre cam:q (chaîne à 0x125064) pour la caméra intérieure ; ses appels ne sont pas suivis.' },
  { module: 'qtm', service: 'gpio:QTM', note: 'qtm ouvre gpio:QTM (chaîne dans la zone 0x125064) ; ses appels ne sont pas suivis.' },
  { module: 'qtm', service: 'hid:QTM', text: EXHEADER_TEXT, note: 'qtm déclare hid:QTM dans son exheader ; le nom n\'est que dans la liste de la bibliothèque commune.' },
  { module: 'qtm', service: 'cfg:s', text: EXHEADER_TEXT, note: 'qtm déclare cfg:s dans son exheader ; le nom n\'est que dans la liste de la bibliothèque commune.' },
  { module: 'qtm', service: 'ptm:s', text: EXHEADER_TEXT, note: 'qtm déclare ptm:s dans son exheader ; le nom n\'est que dans la liste de la bibliothèque commune.' });
// Liens de 3dbrew que l'exheader confirme ou contredit (nfc.md ligne 16 ; qtm.md ligne 16).
CALL_NOTES.push(
  { module: 'nfc', service: 'ir:USER', seen: { module: 'nfc',
    text: 'Le nfc lu est celui de la New 3DS (0004013020004002) : son exheader ne déclare pas ir:USER. Le lecteur NFC de l\'ancienne 3DS n\'est pas lu.' } },
  { module: 'nfc', service: 'i2c::NFC', seen: { module: 'nfc',
    text: 'Confirmé par l\'exheader de nfc ; la chaîne i2c::NFC est à 0x135000 dans le code.' } },
  { module: 'nfc', service: 'gpio:NFC', seen: { module: 'nfc',
    text: 'Confirmé par l\'exheader de nfc ; la chaîne gpio:NFC est à 0x135009 dans le code.' } },
  { module: 'nfc', service: 'hid:NFC', seen: { module: 'nfc',
    text: 'Confirmé par l\'exheader de nfc ; ses appels ne sont pas suivis.' } },
  { module: 'qtm', service: 'i2c::QTM', seen: { module: 'qtm',
    text: 'Confirmé par l\'exheader de qtm ; la chaîne i2c::QTM est dans la zone 0x125064 du code.' } });

/* ============================================================ application */
const same =(a, b) => JSON.stringify(a) === JSON.stringify(b);
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

  // --- lignes de 3dbrew perdues par une cellule étendue sur deux lignes
  for (const fix of ROWSPAN_ROWS) {
    const s = service(fix.service, 'ligne perdue');
    if (!s) continue;
    const twin = s.commandes.find(c => c.h === fix.same);
    if (!twin) { problems.push(fix.service + ' : la commande ' + fix.same + ' dont ' + fix.h + ' partage la cellule n\'est plus dans la Carte'); continue; }
    if (s.commandes.some(c => c.h === fix.h)) continue;
    const row = { h: fix.h, n: twin.n, url: twin.url };
    if (twin.nonLue) row.nonLue = true;
    s.commandes.push(row);
    s.commandes.sort((a, b) => parseInt(a.h, 16) - parseInt(b.h, 16));
    done.push('ligne de 3dbrew retrouvée : ' + fix.service + ' ' + fix.h + ' (' + twin.n + ')');
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
    if (!partial && !command && !fix.add) {
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
    const target = { service: fix.service, note: fix.note, seen: [{ module: fix.module, text: fix.text || CALL_TEXT }] };
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
