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
    ok(URL3DBREW.test(a.url), m.id + ' -> ' + a.service + ' : adresse 3dbrew');
  }
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

console.log(verifs + ' vérifications, ' + echecs + ' échec' + (echecs > 1 ? 's' : ''));
console.log(D.modules.length + ' modules, ' + D.services.length + ' services, ' + nCmd + ' commandes par service (' + unique.size + ' distinctes), ' + D.svc.length + ' SVC');
process.exit(echecs ? 1 : 0);
