// Vérifie les données embarquées de la carte des services. Usage : node tests.js
'use strict';
const { DONNEES: D, decoderEnTete, trouverEnTete, regionDe } = require('./donnees.js');

let echecs = 0, verifs = 0;
function ok(cond, msg) {
  verifs++;
  if (!cond) { echecs++; console.log('ÉCHEC : ' + msg); }
}
const URL3DBREW = /^https:\/\/www\.3dbrew\.org\/wiki\/[^\s]+$/;
const HEX8 = /^0x[0-9A-F]{8}$/;

// --- modules et services
const modules = new Map(D.modules.map(m => [m.id, m]));
const services = new Map(D.services.map(s => [s.id, s]));
ok(modules.size === D.modules.length, 'identifiants de modules uniques');
ok(services.size === D.services.length, 'identifiants de services uniques');
ok(new Set(D.modules.map(m => m.ligne)).size === D.modules.length, 'numéros de ligne uniques');
const familles = new Set(D.familles.map(f => f.id));
ok(new Set(D.familles.map(f => f.couleur)).size === D.familles.length, 'une couleur par famille');

for (const m of D.modules) {
  ok(familles.has(m.famille), m.id + ' : famille connue');
  ok(URL3DBREW.test(m.url), m.id + ' : adresse 3dbrew');
  ok(m.role && m.role.length > 20, m.id + ' : rôle écrit');
  ok(m.services.length > 0, m.id + ' : au moins un service');
  for (const s of m.services) ok(services.has(s) && services.get(s).module === m.id, m.id + ' : le service ' + s + ' existe et lui appartient');
  for (const a of m.appelle) {
    ok(services.has(a.service), m.id + ' appelle un service connu : ' + a.service);
    ok(services.has(a.service) && services.get(a.service).module !== m.id, m.id + ' appelle un autre module que lui-même : ' + a.service);
    // un lien vient de 3dbrew (il a son adresse) ou du code de la console (il a une note « seen »)
    ok(a.url ? URL3DBREW.test(a.url) : (a.seen || []).length > 0, m.id + ' -> ' + a.service + ' : adresse 3dbrew, ou note du code');
    ok(typeof a.note === 'string' && a.note.length > 0, m.id + ' -> ' + a.service + ' : a une note');
    ok(services.has(a.service) && (services.get(a.service).appelants || []).includes(m.id), m.id + ' -> ' + a.service + ' : la station connaît sa correspondance');
  }
}
for (const s of D.services) for (const a of s.appelants || []) {
  ok(modules.has(a) && modules.get(a).appelle.some(x => x.service === s.id), s.id + ' : la correspondance ' + a + ' a son lien dans le module');
}

let nCmd = 0;
const unique = new Set();
for (const s of D.services) {
  ok(modules.has(s.module), s.id + ' : a un module');
  ok(modules.has(s.module) && modules.get(s.module).services.includes(s.id), s.id + ' : listé par son module');
  ok(URL3DBREW.test(s.url), s.id + ' : adresse 3dbrew');
  const vus = new Set();
  for (const c of s.commandes) {
    nCmd++;
    unique.add(c.url + c.h);
    ok(HEX8.test(c.h), s.id + ' : en-tête valide ' + c.h);
    ok(!vus.has(c.h), s.id + ' : en-tête unique ' + c.h);
    vus.add(c.h);
    ok(typeof c.n === 'string' && c.n.length > 0, s.id + ' ' + c.h + ' : a un nom');
    ok(URL3DBREW.test(c.url), s.id + ' ' + c.h + ' : adresse 3dbrew');
    if (c.p) ok(D.details[c.p] && (D.details[c.p].req.length || D.details[c.p].rep.length || D.details[c.p].desc), s.id + ' ' + c.h + ' : détails présents');
    const d = decoderEnTete(c.h);
    ok(d.inutilise === 0 || s.module === 'pxi', s.id + ' ' + c.h + ' : bits 12 à 15 à zéro');
  }
  for (const p of s.partiels || []) ok(URL3DBREW.test(p.url), s.id + ' partiel ' + p.brut + ' : adresse 3dbrew');
}

// Les services qu'un jeu appelle ont tous des commandes.
const JEU = ['fs:USER', 'gsp::Gpu', 'gsp::Lcd', 'hid:USER', 'hid:SPVR', 'dsp::DSP', 'APT:U', 'APT:A', 'ns:s', 'cfg:u', 'cfg:s', 'ptm:u', 'ptm:sysm',
  'ndm:u', 'am:u', 'am:net', 'cecd:u', 'nim:u', 'boss:U', 'csnd:SND', 'mic:u', 'cam:u', 'y2r:u', 'ir:USER', 'ir:rst', 'ir:u', 'nfc:u', 'qtm:u',
  'ldr:ro', 'pm:app', 'srv:', 'err:f', 'ac:u', 'nwm::UDS', 'soc:U', 'http:C', 'ssl:C', 'frd:u', 'news:u', 'act:u', 'dlp:SRVR', 'dlp:CLNT', 'mvd:STD'];
for (const id of JEU) ok(services.has(id) && services.get(id).commandes.length > 0, id + ' : service de jeu avec ses commandes');

// --- décodeur d'en-tête
const d = decoderEnTete('0x080201C2');
ok(d.commande === 0x0802 && d.normaux === 7 && d.traduction === 2, 'décodage de 0x080201C2 : commande 0x0802, 7 normaux, 2 de traduction');
const d2 = decoderEnTete(0x08030204);
ok(d2.commande === 0x0803 && d2.normaux === 8 && d2.traduction === 4, 'décodage de 0x08030204 : commande 0x0803, 8 normaux, 4 de traduction');
// Sur 3dbrew, OpenFile est 0x080201C2 ; 0x08030204 est OpenFileDirectly (ouvrir sans archive préalable).
const t1 = trouverEnTete('0x080201C2');
ok(t1.exactes.some(r => r.service === 'fs:USER' && r.commande.n === 'OpenFile'), '0x080201C2 retrouve fs:USER OpenFile');
const t2 = trouverEnTete('0x08030204');
ok(t2.exactes.some(r => r.service === 'fs:USER' && r.commande.n === 'OpenFileDirectly'), '0x08030204 retrouve fs:USER OpenFileDirectly');
ok(t2.exactes.every(r => r.commande.h === '0x08030204'), '0x08030204 : seulement des correspondances exactes');
const t3 = trouverEnTete('0x00050100');
ok(t3.exactes.some(r => r.service === 'srv:' && r.commande.n === 'GetServiceHandle'), '0x00050100 retrouve srv:GetServiceHandle');
const t4 = trouverEnTete('0x08010100');
ok(t4.exactes.length + t4.proches.length > 0, '0x08010100 donne au moins une piste');

// --- appels système
ok(D.svc.length >= 100, 'au moins 100 appels système (' + D.svc.length + ')');
ok(new Set(D.svc.map(s => s.n)).size === D.svc.length, 'numéros de SVC uniques');
for (const s of D.svc) {
  ok((s.n >= 1 && s.n <= 0x7F) || s.n === 0xFF, 'SVC ' + s.n + ' dans la plage');
  ok(s.nom && s.sig, 'SVC ' + s.n + ' : nom et signature');
  ok(URL3DBREW.test(s.url), 'SVC ' + s.n + ' : adresse 3dbrew');
}
const s32 = D.svc.find(s => s.n === 0x32);
ok(s32 && s32.nom === 'SendSyncRequest', 'svc 0x32 est SendSyncRequest');
ok(D.svc.find(s => s.n === 0x01).nom === 'ControlMemory', 'svc 0x01 est ControlMemory');

// --- mémoire
for (const vue of ['virtuelle', 'physique', 'fcram']) {
  for (const m of ['old', 'new']) {
    const l = D.memoire[vue][m];
    ok(l.length > 0, vue + ' ' + m + ' : des régions');
    for (const r of l) ok(URL3DBREW.test(r.url), vue + ' ' + m + ' ' + r.nom + ' : adresse 3dbrew');
  }
}
const r = regionDe('0x1FF82000');
ok(r.some(x => x.vue === 'virtuelle' && x.modele === 'old' && /TLS/.test(x.region.nom)), '0x1FF82000 tombe dans le TLS (ancienne 3DS)');
ok(r.some(x => x.vue === 'virtuelle' && x.modele === 'new' && /TLS/.test(x.region.nom)), '0x1FF82000 tombe dans le TLS (New 3DS)');
ok(r.some(x => x.vue === 'physique' && /AXI WRAM/.test(x.region.nom)), '0x1FF82000 est aussi en AXI WRAM côté physique');
const r2 = regionDe(0x30001000);
ok(r2.some(x => x.modele === 'old' && /linéaire/.test(x.region.nom)), '0x30001000 est dans le tas linéaire');
const r3 = regionDe(0x38000000);
ok(!r3.some(x => x.vue === 'virtuelle' && x.modele === 'old') && r3.some(x => x.vue === 'virtuelle' && x.modele === 'new'), '0x38000000 : tas linéaire seulement sur New 3DS');
ok(regionDe(0x1E800000).some(x => x.modele === 'new' && x.vue === 'virtuelle') && !regionDe(0x1E800000).some(x => x.modele === 'old' && x.vue === 'virtuelle'), '0x1E800000 : mémoire en plus de la New 3DS');
const r4 = regionDe(0x24000000); // FCRAM + 0x04000000
ok(r4.some(x => x.vue === 'fcram' && x.modele === 'old' && x.region.nom === 'SYSTEM'), 'FCRAM+0x04000000 : SYSTEM sur l\'ancienne 3DS');
ok(r4.some(x => x.vue === 'fcram' && x.modele === 'new' && x.region.nom === 'APPLICATION'), 'FCRAM+0x04000000 : APPLICATION sur New 3DS');

// --- corrections et notes « vu dans le code » (corrections.js)
const fsNode = require('fs'), pathNode = require('path');
const { applyCorrections, readPxiTables, UNNAMED } = require('./corrections.js');
const commande = (sid, h) => (services.get(sid) || { commandes: [] }).commandes.find(c => c.h === h);
const partiel = (sid, id) => ((services.get(sid) || {}).partiels || []).find(p => p.id === id);
const numero = h => h.slice(0, 6);

// d'où viennent les notes : des modules connus, et leurs fiches à côté du projet
const source = D.codeSource;
ok(source && /^\.\.\/[^:]+\/$/.test(source.fiches), 'codeSource : un dossier de fiches en chemin relatif');
ok(source.modules.length === new Set(source.modules).size && source.modules.every(m => modules.has(m)), 'codeSource : des modules connus, sans doublon');
const dossierFiches = pathNode.join(__dirname, source.fiches);
if (fsNode.existsSync(dossierFiches)) {
  for (const m of source.modules) ok(fsNode.existsSync(pathNode.join(dossierFiches, m + '.md')), 'codeSource : la fiche de ' + m + ' existe');
}

// chaque note « seen », où qu'elle soit, a un module lu, un texte, et un en-tête du même numéro que l'entrée
let nNotes = 0;
function verifierNotes(entree, ou, enTete, estCommande) {
  if (entree.seen === undefined) return;
  ok(Array.isArray(entree.seen) && entree.seen.length > 0, ou + ' : seen est une liste non vide');
  for (const n of entree.seen) {
    nNotes++;
    ok(source.modules.includes(n.module), ou + ' : note d\'un module lu dans le code (' + n.module + ')');
    ok(typeof n.text === 'string' && n.text.length > 10, ou + ' : note avec un texte');
    ok(Object.keys(n).every(k => ['module', 'text', 'h', 'byCode'].includes(k)), ou + ' : note sans champ inconnu');
    if (n.h !== undefined) ok(estCommande && HEX8.test(n.h) && n.h !== enTete && numero(n.h) === numero(enTete), ou + ' : l\'en-tête du code ' + n.h + ' diffère de celui de 3dbrew et garde son numéro');
    if (n.byCode !== undefined) ok(estCommande && n.byCode === true && n.h === undefined, ou + ' : byCode seulement sur une commande dont l\'en-tête vient du code');
  }
}
for (const s of D.services) {
  verifierNotes(s, s.id);
  for (const c of s.commandes) verifierNotes(c, s.id + ' ' + c.h, c.h, true);
  for (const p of s.partiels || []) {
    verifierNotes(p, s.id + ' ' + p.brut);
    ok(!s.commandes.some(c => numero(c.h) === p.id && (c.seen || []).some(n => n.byCode)), s.id + ' ' + p.brut + ' : un en-tête complété par le code n\'est plus parmi les incomplets');
  }
}
for (const m of D.modules) for (const a of m.appelle) verifierNotes(a, m.id + ' -> ' + a.service);
ok(nNotes > 0, 'des notes « vu dans le code » (' + nNotes + ')');

// divergences : la valeur de 3dbrew reste, celle du code est à côté
for (const [sid, h3dbrew, module_, hCode] of [
  ['cdc:HID', '0x00010042', 'hid', '0x00010000'], ['cdc:HID', '0x00020042', 'hid', '0x00020000'],
  ['cdc:DSP', '0x00040042', 'dsp', '0x000400C0'], ['cdc:DSP', '0x00060080', 'dsp', '0x00060000'],
  ['mcu::RTC', '0x00210080', 'ptm', '0x00210000'], ['mcu::RTC', '0x002E0000', 'ptm', '0x002E0040']]) {
  const c = commande(sid, h3dbrew);
  ok(c && (c.seen || []).some(n => n.module === module_ && n.h === hCode), sid + ' ' + h3dbrew + ' : 3dbrew gardé, ' + hCode + ' noté pour le code de ' + module_);
  ok(!commande(sid, hCode), sid + ' : ' + hCode + ' n\'a pas remplacé l\'en-tête de 3dbrew');
}
const gyro = commande('mcu::HID', '0x00060000');
ok(gyro && gyro.n === 'ReadGyroscopeValues' && (gyro.seen || []).some(n => n.module === 'hid' && /accéléromètre/.test(n.text)), 'mcu::HID 0x00060000 : nom de 3dbrew gardé, usage vu dans hid noté');
const getData = commande('cdc:HID', '0x00010042');
ok(getData && !getData.nonLue && getData.p === 'Cdc:HID:GetData' && D.details['Cdc:HID:GetData'].rep.length === 3, 'cdc:HID GetData : page relue, trois mots de réponse');

// en-têtes que 3dbrew laisse incomplets : complétés quand le code vérifie ou envoie l'en-tête entier, annotés sinon
for (const [sid, h] of [['cfg:i', '0x081A0042'], ['cfg:i', '0x081B0042'], ['cfg:i', '0x081E0042'], ['cfg:i', '0x08200042'],
  ['SPI::NOR', '0x00010080'], ['SPI::NOR', '0x00020040'], ['SPI::NOR', '0x000500C0'], ['pxi:mc', '0x000A00C0']]) {
  const c = commande(sid, h);
  ok(c && (c.seen || []).some(n => n.byCode) && URL3DBREW.test(c.url), sid + ' ' + h + ' : en-tête complété par le code, page 3dbrew gardée');
  ok(!partiel(sid, numero(h)), sid + ' ' + numero(h) + ' : retiré des en-têtes incomplets');
}
for (const [sid, id] of [['cfg:i', '0x0819'], ['cfg:i', '0x081C'], ['cfg:i', '0x081D'], ['cfg:i', '0x081F'],
  ['ptm:sysm', '0x0816'], ['ptm:sysm', '0x0817'], ['ptm:s', '0x0816'], ['ptm:s', '0x0817'],
  ['hid:SPVR', '0x0003'], ['hid:SPVR', '0x000F'], ['hid:SPVR', '0x0010']]) {
  const p = partiel(sid, id);
  ok(p && (p.seen || []).length === 1 && !commande(sid, id + '0000'), sid + ' ' + id + ' : reste incomplet, avec ce que le code en fait');
}
ok(partiel('SPI::CD2', '0x0001') && !commande('SPI::CD2', '0x00010080'), 'SPI::CD2 : pas complété, le code lu ne parle qu\'à SPI::NOR');

// noms tronqués : plus de type C ni de premier mot de phrase en guise de nom
const TYPES_C = ['u8', 'u16', 'u32', 'u64', 's8', 's16', 's32', 'bool', 'void', 'Handle'];
for (const s of D.services) {
  for (const c of s.commandes) {
    ok(!TYPES_C.includes(c.n), s.id + ' ' + c.h + ' : le nom n\'est pas un type (' + c.n + ')');
    if (c.note && c.note !== c.n && c.note.startsWith(c.n + ' ') && /^[A-Z][a-z]+$/.test(c.n)) {
      // un seul mot suivi d'une phrase : ce doit être un nom de commande, suivi de ses paramètres ou d'une remarque
      ok(/^[A-Z][a-z]+ (\(|[A-Z]|maybe|Not used)/.test(c.note), s.id + ' ' + c.h + ' : « ' + c.n + ' » n\'est pas le premier mot d\'une phrase');
    }
  }
  for (const p of s.partiels || []) ok(!['Abstraction', 'Stubbed', 'Returns', 'Sets', 'Gets'].includes(p.n), s.id + ' ' + p.brut + ' : nom d\'en-tête incomplet non tronqué');
}
for (const sid of ['APT:U', 'APT:A', 'APT:S']) {
  const c = commande(sid, '0x00540040');
  ok(c && c.n === UNNAMED && /^Takes an unknown parameter/.test(c.note), sid + ' 0x00540040 : sans nom, la phrase de 3dbrew en note');
}
ok(commande('ns:s', '0x00090000').n === UNNAMED && commande('ns:s', '0x000F0000').n === UNNAMED, 'ns:s : « Gamecard » et « This » ne sont plus des noms');
ok(commande('cam:u', '0x003F0040').n === UNNAMED, 'cam:u 0x003F0040 : « Stubbed » n\'est plus un nom');
ok(commande('mcu::RTC', '0x00210080').n === 'GetStepCount' && commande('mcu::RTC', '0x002E0000').n === 'SetPowerModeIndicatorState', 'mcu::RTC : le nom suit le type');
ok(commande('mcu::RTC', '0x00240000').n === 'GetPowerEventHandle' && commande('mcu::RTC', '0x00230000').n === UNNAMED, 'mcu::RTC : « Handle GetPowerEventHandle » nommé, « void ??? » sans nom');
ok(commande('i2c::HID', '0x00090080').n === 'ReadRegister8' && commande('gpio:HID', '0x00060080').n === 'SetInterruptMask', 'i2c et gpio : le nom suit le type');
ok(partiel('ptm:sysm', '0x0816').n === UNNAMED && partiel('ptm:sysm', '0x0816').note === 'Abstraction for mcu::RTC::GetSystemClock', 'ptm:sysm 0x0816 : sans nom, le texte de 3dbrew en note');

// les services de pxi ont leur tableau, tiré de leurs pages 3dbrew
const pxi = readPxiTables();
ok(pxi.tables.flatMap(t => t.services).sort().join() === modules.get('pxi').services.slice().sort().join(), 'corrections-pxi.json couvre les services de pxi, et eux seuls');
for (const t of pxi.tables) {
  for (const sid of t.services) {
    const s = services.get(sid);
    ok(s && !s.sansTable && s.commandes.length >= t.commandes.length && s.commandes.length > 0, sid + ' : a son tableau de commandes');
    ok(s && s.url === t.url, sid + ' : renvoie à sa propre page 3dbrew');
    for (const c of t.commandes) ok(commande(sid, c.h) && commande(sid, c.h).n === c.n, sid + ' ' + c.h + ' : ' + c.n);
  }
}
ok(services.get('PxiFS0').commandes.length === 86 && services.get('PxiPM').commandes.length === 3, 'PxiFS0 : 86 commandes ; PxiPM : 3');
ok(trouverEnTete('0x000101C2').exactes.some(r => r.service === 'PxiFS0' && r.commande.n === 'OpenFile'), '0x000101C2 retrouve PxiFS0 OpenFile');
ok(trouverEnTete('0x001200C2').exactes.some(r => r.service === 'PxiFSR' && r.commande.n === 'OpenArchive'), '0x001200C2 retrouve PxiFSR OpenArchive');
ok((services.get('PxiFS0').seen || []).some(n => n.module === 'fs') && (services.get('PxiPM').seen || []).some(n => n.module === 'loader'), 'PxiFS0 et PxiPM : ce que fs et loader envoient');

// services appelés, lus dans le code
const appelle = (mid, sid) => modules.get(mid).appelle.find(a => a.service === sid);
for (const [mid, sid] of [['gsp', 'cfg:s'], ['dsp', 'ptm:s'], ['dsp', 'cfg:s'], ['dsp', 'ps:ps'], ['hid', 'cfg:s'], ['hid', 'ptm:s'],
  ['fs', 'PxiFS0'], ['loader', 'PxiPM'], ['pm', 'Loader'], ['ptm', 'pxi:mc'], ['ns', 'am:u'], ['cfg', 'ps:ps']]) {
  const a = appelle(mid, sid);
  ok(a && !a.url && a.seen[0].module === mid && services.get(sid).appelants.includes(mid), mid + ' appelle ' + sid + ' : lu dans le code de ' + mid);
}
ok(appelle('dsp', 'cdc:DSP').url && appelle('dsp', 'pdn:d').url, 'dsp : les liens donnés par 3dbrew gardent leur adresse');
ok(appelle('ptm', 'ns:p').url && appelle('ptm', 'ns:p').seen[0].module === 'ptm', 'ptm -> ns:p : lien de 3dbrew gardé, avec ce que dit le code');

// descripteurs de traduction : ceux des tampons passés par PXI y sont
const motifs = D.ipc.traductions.map(t => t.motif);
ok(new Set(motifs).size === motifs.length, 'descripteurs de traduction : motifs uniques');
ok(motifs.includes('0x00000004') && motifs.includes('0x00000006'), 'descripteurs de traduction : types 4 et 6 présents');
ok(motifs.indexOf('0x00000004') === motifs.indexOf('0x00000002') + 1, 'le descripteur 4 suit le tampon statique');

// donnees.js est à jour : repasser les corrections ne change rien
const copie = JSON.parse(JSON.stringify(D));
const bilan = applyCorrections(copie, pxi);
ok(bilan.problems.length === 0, 'corrections sans problème' + (bilan.problems.length ? ' : ' + bilan.problems.join(' | ') : ''));
ok(JSON.stringify(copie) === JSON.stringify(D), 'donnees.js est à jour : « node corrections.js » ne change rien (' + bilan.done.length + ' correction à refaire)');
// et une donnée abîmée est remise d'aplomb
const abimee = JSON.parse(JSON.stringify(D));
abimee.services.find(s => s.id === 'cdc:HID').commandes.forEach(c => { delete c.seen; });
abimee.services.find(s => s.id === 'PxiPM').commandes = [];
abimee.services.find(s => s.id === 'APT:U').commandes.find(c => c.h === '0x00540040').n = 'Takes';
abimee.modules.find(m => m.id === 'gsp').appelle = abimee.modules.find(m => m.id === 'gsp').appelle.filter(a => a.service !== 'cfg:s');
abimee.services.find(s => s.id === 'cfg:s').appelants = abimee.services.find(s => s.id === 'cfg:s').appelants.filter(a => a !== 'gsp');
const reprise = applyCorrections(abimee, pxi);
// même contenu, sans tenir compte de l'ordre des champs ni de celui des correspondances
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, k === 'appelants' ? v[k].slice().sort() : canon(v[k])])) : v;
ok(reprise.problems.length === 0 && reprise.done.length === 6 && JSON.stringify(canon(abimee.services)) === JSON.stringify(canon(D.services)), 'des services abîmés sont remis d\'aplomb par les corrections');
ok(JSON.stringify(abimee.modules.find(m => m.id === 'gsp').appelle.map(a => a.service).sort()) === JSON.stringify(modules.get('gsp').appelle.map(a => a.service).sort()), 'un lien retiré est remis par les corrections');

console.log(verifs + ' vérifications, ' + echecs + ' échec' + (echecs > 1 ? 's' : ''));
console.log(D.modules.length + ' modules, ' + D.services.length + ' services, ' + nCmd + ' commandes par service (' + unique.size + ' distinctes), ' + D.svc.length + ' SVC');
process.exit(echecs ? 1 : 0);
