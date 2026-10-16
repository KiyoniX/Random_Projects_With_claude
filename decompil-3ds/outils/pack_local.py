"""Range une partie de decompil-3ds/local/ dans des zips de 950 Mo au plus, pour la passer sur une autre machine.

    python outils/pack_local.py        (écrit dans Téléchargements/decompil-3ds-local/ ; voir REPRISE.md)

Les fichiers de plus de 900 Mo sont coupés en morceaux (chemin.part001, .part002...), un morceau par zip.
Un manifeste (SHA-256 de chaque fichier d'origine) et reassembler.py vont à côté des zips.
"""
import hashlib
import json
import os
import sys
import zipfile

LOCAL = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'local')
OUT = os.path.join(os.path.expanduser('~'), 'Downloads', 'decompil-3ds-local')
LIMIT = 950 * 1024 * 1024
PIECE = 900 * 1024 * 1024
INCLUDE_DIRS = ['dump', 'extrait', 'outils', 'telechargements', 'pylib', 'sd', 'sauvegarde-sd', 'mods-build',
                'portage/captures', 'analyse/terrain/rec2']
INCLUDE_FILES = ['recomp/trous.txt', 'recomp/trous-cro.txt']
INCLUDE_GLOBS = [('analyse/pica', '.pkl')]


def collect():
    files = []
    for d in INCLUDE_DIRS:
        base = os.path.join(LOCAL, d)
        for root, _, names in os.walk(base):
            for n in names:
                files.append(os.path.relpath(os.path.join(root, n), LOCAL))
    for f in INCLUDE_FILES:
        if os.path.isfile(os.path.join(LOCAL, f)):
            files.append(f)
    for d, ext in INCLUDE_GLOBS:
        base = os.path.join(LOCAL, d)
        if os.path.isdir(base):
            files += [os.path.join(d, n) for n in os.listdir(base) if n.endswith(ext)]
    return sorted(set(f.replace('\\', '/') for f in files))


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 22), b''):
            h.update(block)
    return h.hexdigest()


def main():
    os.makedirs(OUT, exist_ok=True)
    files = collect()
    manifest = {'files': {}, 'split': {}}
    jobs, bundle, size = [], [], 0          # jobs : [('bundle', [fichiers]) | ('piece', fichier, n, début, taille)]
    for rel in files:
        full = os.path.join(LOCAL, rel)
        n = os.path.getsize(full)
        manifest['files'][rel] = {'size': n}
        if n > PIECE:
            count = (n + PIECE - 1) // PIECE
            manifest['split'][rel] = count
            for i in range(count):
                jobs.append(('piece', rel, i + 1, i * PIECE, min(PIECE, n - i * PIECE)))
            continue
        if size + n > LIMIT and bundle:
            jobs.append(('bundle', bundle))
            bundle, size = [], 0
        bundle.append(rel)
        size += n
    if bundle:
        jobs.append(('bundle', bundle))
    total = len(jobs)
    for k, job in enumerate(jobs, 1):
        name = os.path.join(OUT, 'decompil-local-%03d.zip' % k)
        with zipfile.ZipFile(name, 'w', zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as z:
            if job[0] == 'bundle':
                for rel in job[1]:
                    z.write(os.path.join(LOCAL, rel), 'local/' + rel)
            else:
                _, rel, i, start, length = job
                with open(os.path.join(LOCAL, rel), 'rb') as src, \
                        z.open('local/%s.part%03d' % (rel, i), 'w', force_zip64=True) as dst:
                    src.seek(start)
                    left = length
                    while left:
                        block = src.read(min(1 << 22, left))
                        dst.write(block)
                        left -= len(block)
        print('%d/%d  %s  %.0f Mo' % (k, total, os.path.basename(name), os.path.getsize(name) / 2**20), flush=True)
    for rel in files:
        manifest['files'][rel]['sha256'] = sha256(os.path.join(LOCAL, rel))
    with open(os.path.join(OUT, 'manifeste.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=1)
    print('fini : %d zips, %d fichiers' % (total, len(files)))


if __name__ == '__main__':
    sys.exit(main())
