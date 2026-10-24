"""Regarde ce qui est installé et ce qui est fait, met à jour etat.json, et écrit etat.js pour la page.

    python verifier.py

La page index.html lit etat.js (un fichier JavaScript, parce qu'une page ouverte en file:// ne peut
pas charger un .json). etat.json reste le fichier qu'on édite à la main : paliers, journal, prochaine action.
Ce script n'y touche que les champs qu'il sait mesurer : présence des outils, dump, extraction, date.
"""
import datetime
import json
import os
import shutil
import subprocess

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = os.path.join(RACINE, 'local')
ETAT_JSON = os.path.join(RACINE, 'etat.json')
ETAT_JS = os.path.join(RACINE, 'etat.js')


def existe_sous(dossier, nom):
    for d, _, fichiers in os.walk(dossier) if os.path.isdir(dossier) else []:
        if nom in fichiers:
            return True
    return False


def node_assez_recent():
    node = shutil.which('node')
    if not node:
        return False
    try:
        v = subprocess.check_output([node, '--version'], text=True).strip().lstrip('v').split('.')
        return int(v[0]) >= 22
    except (OSError, ValueError, subprocess.CalledProcessError):
        return False


def rea_installe():
    npm = shutil.which('npm') or shutil.which('npm.cmd')
    if not npm:
        return False
    try:
        sortie = subprocess.run([npm, 'ls', '-g', 'rea-agents', '--depth=0'], capture_output=True, text=True, timeout=30).stdout
        return 'rea-agents@' in sortie
    except (OSError, subprocess.TimeoutExpired):
        return False


def rea_declare():
    """REA est branché quand Claude Code connaît son serveur MCP : « rea setup » l'écrit dans ~/.claude.json,
    et on accepte aussi un .mcp.json à la racine du dépôt ou du projet."""
    candidats = [os.path.join(os.path.expanduser('~'), '.claude.json'),
                 os.path.join(os.path.dirname(RACINE), '.mcp.json'), os.path.join(RACINE, '.mcp.json')]

    def serveurs_de(obj):
        if isinstance(obj, dict):
            for cle, val in obj.items():
                if cle == 'mcpServers' and isinstance(val, dict):
                    for s in val.values():
                        yield s
                else:
                    yield from serveurs_de(val)
        elif isinstance(obj, list):
            for val in obj:
                yield from serveurs_de(val)

    for chemin in candidats:
        if not os.path.isfile(chemin):
            continue
        try:
            with open(chemin, encoding='utf-8') as f:
                config = json.load(f)
        except (OSError, ValueError):
            continue
        for s in serveurs_de(config):
            if isinstance(s, dict) and 'rea' in ' '.join([str(s.get('command', ''))] + [str(a) for a in s.get('args', [])]).lower():
                return True
    return False


def mesurer(etat):
    outils_dir = os.path.join(LOCAL, 'outils')
    presence = {
        'ctrtool': existe_sous(os.path.join(outils_dir, 'ctrtool'), 'ctrtool.exe'),
        'makerom': existe_sous(os.path.join(outils_dir, 'makerom'), 'makerom.exe'),
        'ghidra': os.path.isfile(os.path.join(outils_dir, 'ghidra', 'ghidraRun.bat')),
        'scripts': os.path.isfile(os.path.join(outils_dir, 'ghidra-scripts', 'Label3dsSVCs.py')),
        # Sous Windows, l'installateur règle DEVKITPRO sur un chemin MSYS2 (/opt/devkitpro) que Python
        # ne sait pas lire : on essaie aussi le dossier d'installation par défaut.
        'devkitpro': any(os.path.isdir(os.path.join(d, 'libctru')) for d in (os.environ.get('DEVKITPRO', ''), 'C:\\devkitPro') if d),
        'azahar': bool(shutil.which('azahar')) or os.path.isdir(os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Azahar')) or os.path.isdir('C:\\Program Files\\Azahar'),
        'python': True,
    }
    rea_paquet, rea_mcp = rea_installe(), rea_declare()
    presence['rea'] = rea_paquet and rea_mcp
    for o in etat['outils']:
        if o['id'] in presence:
            o['present'] = presence[o['id']]
        if o['id'] == 'rea':
            o['note'] = 'Paquet %s, déclaration MCP %s, Node %s' % (
                'installé' if rea_paquet else 'absent', 'trouvée' if rea_mcp else 'absente',
                '22+ présent' if node_assez_recent() else 'absent ou trop vieux (il faut 22.19+)')
    dumps = sorted(n for n in os.listdir(os.path.join(LOCAL, 'dump')) if n.lower().endswith(('.cxi', '.app', '.3ds', '.cci'))) if os.path.isdir(os.path.join(LOCAL, 'dump')) else []
    etat['dump'] = {'present': bool(dumps), 'fichiers': dumps}
    if dumps:
        import inspecter
        try:
            r = inspecter.inspecter(os.path.join(LOCAL, 'dump', dumps[0]), empreinte=False)
            etat['dump'].update({'titre': r['titre'], 'produit': r['produit'], 'dechiffre': r['dechiffre'], 'exefs': r['exefs'], 'romfs': r['romfs']})
        except (ValueError, OSError) as e:
            etat['dump']['erreur'] = str(e)
    code_bin = os.path.join(LOCAL, 'extrait', 'exefs', 'code.bin')
    etat['extrait'] = {'present': os.path.isfile(code_bin), 'code_octets': os.path.getsize(code_bin) if os.path.isfile(code_bin) else 0}
    # Les tâches que la machine peut cocher elle-même.
    auto = {
        (1, 2): etat['dump']['present'], (1, 3): etat['extrait']['present'],
        (2, 0): presence['devkitpro'], (2, 1): presence['rea'], (3, 0): presence['ghidra'] and presence['scripts'],
    }
    for p in etat['paliers']:
        for i, t in enumerate(p['taches']):
            if (p['id'], i) in auto and auto[(p['id'], i)]:
                t['fait'] = True
    etat['mise_a_jour'] = datetime.date.today().isoformat()
    return etat


def avancement(etat):
    total = sum(p['poids'] for p in etat['paliers'])
    fait = sum(p['poids'] * sum(t['fait'] for t in p['taches']) / len(p['taches']) for p in etat['paliers'])
    return round(100 * fait / total, 1)


def lire():
    with open(ETAT_JSON, encoding='utf-8') as f:
        return json.load(f)


def ecrire(etat):
    """etat.json, et etat.js pour la page. Aussi appelé par couverture.py, qui y range le compteur de fonctions."""
    with open(ETAT_JSON, 'w', encoding='utf-8') as f:
        json.dump(etat, f, ensure_ascii=False, indent=2)
        f.write('\n')
    # La page montre aussi le journal brut : les commits du dossier, tirés de git à chaque écriture (pas dans
    # etat.json, que git suit déjà).
    log = subprocess.run(['git', 'log', '--date=short', '--format=%ad%x09%s', '--', '.'], cwd=RACINE,
                         capture_output=True, text=True, encoding='utf-8')
    commits = [line.split('\t', 1) for line in log.stdout.splitlines() if '\t' in line] if log.returncode == 0 else []
    with open(ETAT_JS, 'w', encoding='utf-8') as f:
        f.write('// Écrit par outils/verifier.py. Éditer etat.json, pas ce fichier.\nwindow.ETAT = ')
        json.dump(dict(etat, commits=commits), f, ensure_ascii=False, indent=1)
        f.write(';\n')


if __name__ == '__main__':
    etat = mesurer(lire())
    ecrire(etat)
    print('Avancement global : %s %%' % avancement(etat))
    for o in etat['outils']:
        if o['lieu'] == 'pc':
            print('  %-28s %s' % (o['nom'], 'présent' if o['present'] else 'absent'))
    print('  dump : %s' % (', '.join(etat['dump']['fichiers']) if etat['dump']['present'] else 'aucun dans local/dump/'))
    print('  extrait : %s' % ('code.bin de %d octets' % etat['extrait']['code_octets'] if etat['extrait']['present'] else 'pas encore'))
