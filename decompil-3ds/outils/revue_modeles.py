"""Montrer chaque Pokémon, vu de face et de dos, à l'utilisateur, qui dit si son modèle est bon.

    python revue_modeles.py liste                         espèces et formes à passer, d'après la table « personal » du jeu
    python revue_modeles.py rendre [--travailleurs N] [--limite N] [--seulement ESPECE[:FORME],...]
    python revue_modeles.py page [--port 8765]            la page de relecture, sur http://127.0.0.1:8765 (cette machine seulement)
    python revue_modeles.py test

Les images passent par le vrai moteur (`runtime run --dessiner`, échelle 4) : c'est lui qu'on juge, pas le fichier du modèle.
Pour chaque Pokémon, on rejoue la partie de `PARTIE` jusqu'au combat contre le dresseur 86, avec un mod qui lui donne ce
Pokémon (`a/0/4/0`), et une sauvegarde où il est aussi en tête de notre équipe. Tout ce que ça produit reste dans
`local/analyse/modeles/` : les images viennent du jeu et la page n'est servie qu'à cette machine.

Le Pokémon de tête : `pk6.py`.

Une équipe de dresseur à 8 octets par Pokémon (`a/0/4/0`) : niveau u16 à +2, espèce u16 à +4, forme u16 à +6.
"""
import argparse
import glob
import http.server
import json
import os
import shutil
import struct
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import garc
import pk6
import teleporter
import tournee
import texte

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTIE = os.path.join(RACINE, 'local', 'analyse', 'rendu', 'mods-test', 'simple')
SORTIE = os.path.join(RACINE, 'local', 'analyse', 'modeles')
RUNTIME = os.path.join(RACINE, 'portage', 'target', 'release', 'runtime.exe')
EQUIPES = os.path.join(RACINE, 'local', 'extrait', 'romfs', 'a', '0', '4', '0')
PERSONAL = os.path.join(RACINE, 'local', 'extrait', 'romfs', 'a', '2', '1', '8')
DRESSEUR = 86
ENTREE_COMBAT_MS = 21370
TEXTES = os.path.join(RACINE, 'local', 'extrait', 'maj', 'romfs', 'a', '0', '7', '5')
TEXTE_ESPECES = 80
AVIS = os.path.join(SORTIE, 'avis.json')
# Les Non donnés avant le correctif de la ligne au milieu des modèles : à revoir sur les nouvelles images.
ANCIENS = os.path.join(SORTIE, 'avis-avant-correctif.json')
SECONDES = 100
ECHELLE = 4
# La caméra d'attente du combat tourne autour des deux Pokémon : une image toutes les deux secondes, dès qu'ils sont sortis.
PREMIERE_VUE = 30
PAS_DES_VUES = 2


def sauvegarde_avec(sauvegarde, espece, forme):
    """La sauvegarde, ce Pokémon en tête d'équipe, le CRC du bloc de l'équipe à jour."""
    return pk6.avec_tete(sauvegarde, lambda p: pk6.changer_pokemon(p, espece, forme))


def equipes_avec(garc_equipes, espece, forme):
    """Le GARC des équipes, le premier Pokémon du dresseur devenu celui-ci."""
    version, entrees = garc.lire(garc_equipes)
    equipe = bytearray(entrees[DRESSEUR][0])
    struct.pack_into('<HH', equipe, 4, espece, forme)
    entrees[DRESSEUR][0] = bytes(equipe)
    return garc.ecrire(entrees, version)


def a_passer(table):
    """(espèce, forme) de toutes les espèces et formes, d'après les entrées de la table « personal » (+0x20 : nombre de formes)."""
    rendu = []
    for espece in range(1, 722):
        for forme in range(max(table[espece][0][0x20], 1)):
            rendu.append((espece, forme))
    return rendu


def liste():
    with open(PERSONAL, 'rb') as f:
        return a_passer(garc.lire(f.read())[1])


def journal_de_depart(mod):
    """Les entrées de la partie jusqu'au combat."""
    lignes = []
    with open(os.path.join(PARTIE, 'journal.txt'), encoding='utf-8', errors='replace') as f:
        for ligne in f:
            if 'horloge au départ' in ligne:
                lignes.append(ligne.rstrip('\n'))
            elif ' ms] hid : ' in ligne:
                if float(ligne[1:ligne.index(' ms]')]) > ENTREE_COMBAT_MS:
                    break
                lignes.append(ligne.rstrip('\n'))
    if mod:
        lignes.insert(1, f'[     0.000 ms] mod : {mod}')
    # A passe le « veut se battre », et le combat attend devant son menu
    # (la partie tenait A et B à la coupure : relâcher d'abord, sinon A n'est pas un nouvel appui)
    lignes += ['[ 21700.000 ms] hid : boutons tenus 0x0', '[ 27000.000 ms] hid : boutons tenus 0x1', '[ 27100.000 ms] hid : boutons tenus 0x0']
    return '\n'.join(lignes) + '\n'


def rendre_un(espece, forme, sauvegarde, equipes):
    nom = f'{espece:03d}-{forme:02d}'
    dossier = os.path.join(SORTIE, 'rendu', nom)
    if os.path.exists(os.path.join(dossier, 'verdict.json')):
        return
    shutil.rmtree(dossier, ignore_errors=True)
    entree = os.path.join(dossier, 'in')
    shutil.copytree(os.path.join(PARTIE, 'depart'), os.path.join(entree, 'depart'))
    with open(os.path.join(entree, 'depart', 'sauvegarde', 'main'), 'wb') as f:
        f.write(sauvegarde_avec(sauvegarde, espece, forme))
    mod = tournee.mod_fichiers(os.path.join(entree, 'mod'), {'a/0/4/0': equipes_avec(equipes, espece, forme)})
    with open(os.path.join(entree, 'journal.txt'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(journal_de_depart(mod))
    debut = time.time()
    sortie = os.path.join(dossier, 'out')
    with open(os.path.join(dossier, 'sortie.txt'), 'wb') as o:
        try:
            code = subprocess.run([RUNTIME, 'run', '--rejouer', os.path.join(entree, 'journal.txt'), '--dessiner', '--scale', str(ECHELLE),
                                   '--seconds', str(SECONDES), '--out', sortie], stdout=o, stderr=subprocess.STDOUT, timeout=900).returncode
        except subprocess.TimeoutExpired:
            code = 'trop long'
    images = sorted(glob.glob(os.path.join(sortie, 'images', '*haut.png')))
    verdict = {'espece': espece, 'forme': forme, 'code': code, 'secondes_pc': round(time.time() - debut), 'images': len(images)}
    garder_vues(images, os.path.join(dossier, 'vues'))
    # un rendu normal ne garde que ses vues (le disque) ; les autres gardent de quoi enquêter
    if code == 0 and len(images) >= SECONDES - 1:
        shutil.rmtree(sortie, ignore_errors=True)
        shutil.rmtree(entree, ignore_errors=True)
    else:
        verdict['anomalie'] = True
    with open(os.path.join(dossier, 'verdict.json'), 'w', encoding='utf-8') as f:
        json.dump(verdict, f)
    print(nom, code, verdict['secondes_pc'], 's', len(images), 'images', flush=True)


def garder_vues(images, dossier):
    from PIL import Image
    os.makedirs(dossier, exist_ok=True)
    prochaine = PREMIERE_VUE
    for chemin in images:
        # 045-044.48s-haut.png : le temps de jeu est dans le nom
        temps = float(os.path.basename(chemin).split('-')[1][:-1])
        if temps >= prochaine:
            Image.open(chemin).convert('RGB').save(os.path.join(dossier, f'{int(temps):03d}.jpg'), quality=85)
            prochaine += PAS_DES_VUES


def rendre(travailleurs, limite, seulement):
    with open(EQUIPES, 'rb') as f:
        equipes = f.read()
    with open(os.path.join(PARTIE, 'depart', 'sauvegarde', 'main'), 'rb') as f:
        sauvegarde = f.read()
    a_faire = seulement or liste()
    if limite:
        a_faire = a_faire[:limite]
    with ThreadPoolExecutor(travailleurs) as pool:
        list(pool.map(lambda c: rendre_un(c[0], c[1], sauvegarde, equipes), a_faire))


PAGE = """<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Revue des modèles</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--fond:#14161a;--carte:#1e2127;--texte:#e8e8e8;--doux:#9aa0a8;--oui:#2e8b57;--non:#c0392b;--trait:#333842}
*{box-sizing:border-box}body{margin:0;background:var(--fond);color:var(--texte);font:15px/1.4 system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:12px 16px}
header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline}h1{font-size:22px;margin:0}#forme,#progres{color:var(--doux)}#progres{margin-left:auto}
#barre{height:6px;background:var(--trait);border-radius:3px;margin:8px 0;overflow:hidden}#barre div{height:100%;background:var(--oui)}
#vue{width:100%;aspect-ratio:5/3;background:#000;display:block;border-radius:6px;object-fit:contain}
#vide{padding:48px;text-align:center;color:var(--doux)}
.ligne{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}
input[type=range]{flex:1;min-width:160px}
textarea{width:100%;min-height:52px;margin-top:8px;background:var(--carte);color:var(--texte);border:1px solid var(--trait);border-radius:6px;padding:8px;font:inherit}
button,select{background:var(--carte);color:var(--texte);border:1px solid var(--trait);border-radius:6px;padding:8px 12px;font:inherit;cursor:pointer}
button.oui{background:var(--oui);border-color:var(--oui);font-weight:600;padding:12px 32px}button.non{background:var(--non);border-color:var(--non);font-weight:600;padding:12px 32px}
#avis{color:var(--doux)}kbd{background:var(--carte);border:1px solid var(--trait);border-radius:3px;padding:0 4px;font-size:12px}
</style></head><body><main>
<header><h1 id="nom"></h1><span id="forme"></span><span id="progres"></span></header>
<div id="barre"><div></div></div>
<img id="vue" alt="Vue du combat"><div id="vide" hidden>Aucune image pour ce Pokémon : le rendu n'a rien donné.</div>
<div class="ligne"><button id="lire">⏸</button><input type="range" id="temps" min="0" value="0" aria-label="Moment du combat"><select id="filtre" aria-label="Quels Pokémon montrer"><option value="reste">À relire</option><option value="non">Marqués non</option><option value="anciens">Anciens Non, après correctif</option><option value="tout">Tous</option></select></div>
<p id="avant" hidden></p><textarea id="note" placeholder="Commentaire, si besoin : ce qui ne va pas, où, à quel moment"></textarea>
<div class="ligne"><button class="oui" id="oui">Oui, il est bon</button><button class="non" id="non">Non</button><button id="prec">← Précédent</button><button id="suiv">Passer →</button><span id="avis"></span></div>
<p id="aide"><kbd>O</kbd> oui · <kbd>N</kbd> non · <kbd>←</kbd> <kbd>→</kbd> précédent, suivant · <kbd>Espace</kbd> pause · la caméra du combat tourne : le curseur la fait avancer. Chaque avis s'enregistre tout de suite ; on peut fermer et revenir.</p>
</main><script>
let liste=[],avis={},anciens={},i=0,vue=0,lecture=true;const $=x=>document.getElementById(x);
const cle=p=>p.espece+":"+p.forme;
function visibles(){const f=$("filtre").value;return liste.filter(p=>f==="tout"||(f==="reste"&&!avis[cle(p)])||(f==="non"&&avis[cle(p)]&&avis[cle(p)].bon===false)||(f==="anciens"&&anciens[cle(p)]&&anciens[cle(p)].bon===false))}
function montrer(){const v=visibles();const faits=Object.keys(avis).length;$("progres").textContent=faits+" / "+liste.length+" relus · "+Object.values(avis).filter(a=>!a.bon).length+" non";$("barre").firstElementChild.style.width=(100*faits/Math.max(liste.length,1))+"%";
 if(!v.length){$("nom").textContent="Plus rien ici";$("forme").textContent="";$("vue").hidden=true;$("vide").hidden=true;return}
 i=Math.min(i,v.length-1);const p=v[i];$("nom").textContent="#"+p.espece+" "+p.nom;$("forme").textContent=p.forme?"forme "+p.forme:"";const a=avis[cle(p)];$("note").value=a?a.note:"";$("avis").textContent=a?(a.bon?"Déjà marqué oui":"Déjà marqué non"):"";const o=anciens[cle(p)];$("avant").hidden=!(o&&o.bon===false);$("avant").textContent=o?"Avant le correctif : Non"+(o.note?" : "+o.note:""):"";
 $("temps").max=Math.max(p.vues.length-1,0);vue=0;p.vues.forEach(n=>{new Image().src=n});$("vide").hidden=p.vues.length>0;$("vue").hidden=!p.vues.length;afficher()}
function afficher(){const v=visibles();if(!v.length)return;const p=v[i];if(p.vues.length){$("vue").src=p.vues[vue];$("temps").value=vue}}
function tic(){const v=visibles();if(!lecture||!v.length||!v[i].vues.length)return;vue=(vue+1)%v[i].vues.length;afficher()}
function avancer(d){i=Math.max(0,i+d);montrer()}
async function juger(bon){const v=visibles();if(!v.length)return;const p=v[i];const r=await fetch("avis",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cle:cle(p),bon,note:$("note").value})});if(!r.ok){$("avis").textContent="Non enregistré : "+r.status;return}avis[cle(p)]={bon,note:$("note").value};const w=visibles();if(w[i]&&cle(w[i])===cle(p))i++;montrer()}
$("oui").onclick=()=>juger(true);$("non").onclick=()=>juger(false);$("prec").onclick=()=>avancer(-1);$("suiv").onclick=()=>avancer(1);$("filtre").onchange=()=>{i=0;montrer()};
$("lire").onclick=()=>{lecture=!lecture;$("lire").textContent=lecture?"⏸":"▶"};$("temps").oninput=e=>{vue=+e.target.value;lecture=false;$("lire").textContent="▶";afficher()};
addEventListener("keydown",e=>{if(e.target.tagName==="TEXTAREA"||e.target.tagName==="SELECT")return;const k=e.key.toLowerCase();if(k==="o")juger(true);else if(k==="n")juger(false);else if(k==="arrowleft")avancer(-1);else if(k==="arrowright")avancer(1);else if(k===" "){e.preventDefault();$("lire").click()}});
(async()=>{const r=await(await fetch("etat")).json();liste=r.liste;avis=r.avis;anciens=r.anciens;if(location.hash==="#anciens")$("filtre").value="anciens";montrer();setInterval(tic,700);setInterval(async()=>{const n=await(await fetch("etat")).json();const vide=!visibles().length;const q=visibles()[i];liste=n.liste;if(q){const j=visibles().findIndex(p=>cle(p)===cle(q));if(j>=0)i=j}if(vide)montrer()},30000)})();
</script></body></html>
"""


def noms_des_especes():
    with open(TEXTES, 'rb') as f:
        return texte.decoder(garc.lire(f.read())[1][TEXTE_ESPECES][0])


def etat_de_la_revue(racine, noms):
    """Les Pokémon déjà rendus, avec leurs vues. La page en redemande pendant qu'un rendu tourne."""
    rendu = []
    for dossier in sorted(glob.glob(os.path.join(racine, '[0-9]*-[0-9]*'))):
        nom = os.path.basename(dossier)
        espece, forme = map(int, nom.split('-'))
        if not os.path.exists(os.path.join(dossier, 'verdict.json')):
            continue
        vues = sorted(os.listdir(os.path.join(dossier, 'vues'))) if os.path.isdir(os.path.join(dossier, 'vues')) else []
        rendu.append({'espece': espece, 'forme': forme, 'nom': noms[espece] if espece < len(noms) else '?', 'vues': [f'vues/{nom}/{v}' for v in vues]})
    return rendu


def lire_avis(chemin):
    if not os.path.exists(chemin):
        return {}
    with open(chemin, encoding='utf-8') as f:
        return json.load(f)


def ecrire_avis(chemin, avis):
    # le fichier ne doit jamais rester à moitié écrit : c'est le travail de l'utilisateur
    provisoire = chemin + '.tmp'
    with open(provisoire, 'w', encoding='utf-8') as f:
        json.dump(avis, f, ensure_ascii=False, indent=1, sort_keys=True)
    os.replace(provisoire, chemin)


def serveur(racine, chemin_avis, noms, port, chemin_anciens=ANCIENS):
    verrou = threading.Lock()

    class Page(http.server.BaseHTTPRequestHandler):
        def repondre(self, code, corps, genre):
            self.send_response(code)
            self.send_header('Content-Type', genre)
            self.send_header('Content-Length', str(len(corps)))
            self.end_headers()
            self.wfile.write(corps)

        def do_GET(self):
            if self.path == '/':
                self.repondre(200, PAGE.encode('utf-8'), 'text/html; charset=utf-8')
            elif self.path == '/etat':
                with verrou:
                    etat = {'liste': etat_de_la_revue(racine, noms), 'avis': lire_avis(chemin_avis), 'anciens': lire_avis(chemin_anciens)}
                self.repondre(200, json.dumps(etat).encode('utf-8'), 'application/json')
            elif self.path.startswith('/vues/'):
                morceaux = self.path.split('/')
                # /vues/005-00/045.jpg et rien d'autre : la page ne sert aucun autre fichier
                if len(morceaux) == 4 and morceaux[2].replace('-', '').isdigit() and morceaux[3][:-4].isdigit() and morceaux[3].endswith('.jpg'):
                    chemin = os.path.join(racine, morceaux[2], 'vues', morceaux[3])
                    if os.path.exists(chemin):
                        with open(chemin, 'rb') as f:
                            return self.repondre(200, f.read(), 'image/jpeg')
                self.repondre(404, b'', 'text/plain')
            else:
                self.repondre(404, b'', 'text/plain')

        def do_POST(self):
            if self.path != '/avis':
                return self.repondre(404, b'', 'text/plain')
            try:
                donnees = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                entree = {'bon': bool(donnees['bon']), 'note': str(donnees.get('note', ''))}
                cle = str(donnees['cle'])
            except (ValueError, KeyError, TypeError):
                return self.repondre(400, b'', 'text/plain')
            with verrou:
                avis = lire_avis(chemin_avis)
                avis[cle] = entree
                ecrire_avis(chemin_avis, avis)
            self.repondre(200, b'{}', 'application/json')

        def log_message(self, *_):
            pass

    return http.server.ThreadingHTTPServer(('127.0.0.1', port), Page)


def test():
    # la page : un rendu fabriqué, un avis envoyé, gardé sur le disque
    import tempfile
    import urllib.error
    import urllib.request
    with tempfile.TemporaryDirectory() as racine:
        os.makedirs(os.path.join(racine, '005-00', 'vues'))
        with open(os.path.join(racine, '005-00', 'verdict.json'), 'w') as f:
            f.write('{}')
        with open(os.path.join(racine, '005-00', 'vues', '030.jpg'), 'wb') as f:
            f.write(b'image')
        os.makedirs(os.path.join(racine, '006-00'))  # pas encore fini : pas de verdict
        chemin = os.path.join(racine, 'avis.json')
        anciens = os.path.join(racine, 'anciens.json')
        ecrire_avis(anciens, {'5:0': {'bon': False, 'note': 'ligne'}})
        serv = serveur(racine, chemin, ['Oeuf', 'a', 'b', 'c', 'd', 'Reptincel'], 0, anciens)
        threading.Thread(target=serv.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{serv.server_address[1]}'
        etat = json.load(urllib.request.urlopen(base + '/etat'))
        assert etat['liste'] == [{'espece': 5, 'forme': 0, 'nom': 'Reptincel', 'vues': ['vues/005-00/030.jpg']}] and etat['avis'] == {}
        assert etat['anciens'] == {'5:0': {'bon': False, 'note': 'ligne'}}
        assert urllib.request.urlopen(base + '/vues/005-00/030.jpg').read() == b'image'
        for mauvais in ('/vues/../avis.json', '/vues/005-00/..%2f..%2favis.json', '/avis.json'):
            try:
                urllib.request.urlopen(base + mauvais)
            except urllib.error.HTTPError as e:
                assert e.code == 404, mauvais
            else:
                raise AssertionError('servi : ' + mauvais)
        requete = urllib.request.Request(base + '/avis', json.dumps({'cle': '5:0', 'bon': False, 'note': 'coupé en travers'}).encode(), method='POST')
        urllib.request.urlopen(requete)
        assert json.load(urllib.request.urlopen(base + '/etat'))['avis'] == {'5:0': {'bon': False, 'note': 'coupé en travers'}}
        assert lire_avis(chemin)['5:0']['note'] == 'coupé en travers', "l'avis est sur le disque"
        serv.shutdown()
        serv.server_close()
    # un GARC d'équipes et une table « personal » fabriqués
    entrees = [[bytes(8)] for _ in range(DRESSEUR + 1)]
    version = 0x0400
    change = garc.lire(equipes_avec(garc.ecrire(entrees, version), 6, 2))[1][DRESSEUR][0]
    assert struct.unpack_from('<HH', change, 4) == (6, 2)
    table = [[bytes(0x40)] for _ in range(722)]
    deux = bytearray(0x40)
    deux[0x20] = 2
    table[3] = [bytes(deux)]
    assert a_passer(table)[:4] == [(1, 0), (2, 0), (3, 0), (3, 1)] and len(a_passer(table)) == 722
    print('revue_modeles : tests ok')


def main():
    args = argparse.ArgumentParser()
    args.add_argument('action', choices=('liste', 'rendre', 'page', 'test'))
    args.add_argument('--travailleurs', type=int, default=6)
    args.add_argument('--limite', type=int, default=0)
    args.add_argument('--seulement', default='')
    args.add_argument('--port', type=int, default=8765)
    a = args.parse_args()
    if a.action == 'test':
        test()
    elif a.action == 'liste':
        for espece, forme in liste():
            print(espece, forme)
    elif a.action == 'rendre':
        seulement = [tuple(map(int, (c.split(':') + ['0'])[:2])) for c in a.seulement.split(',') if c]
        rendre(a.travailleurs, a.limite, seulement)
    elif a.action == 'page':
        serv = serveur(os.path.join(SORTIE, 'rendu'), AVIS, noms_des_especes(), a.port)
        print(f'Page de relecture : http://127.0.0.1:{a.port}  (Ctrl+C pour arrêter ; les avis sont dans {AVIS})', flush=True)
        serv.serve_forever()


if __name__ == '__main__':
    main()
