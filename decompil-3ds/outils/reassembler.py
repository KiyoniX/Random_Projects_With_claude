"""Remonte decompil-3ds/local/ à partir des zips decompil-local-NNN.zip.

    python reassembler.py CHEMIN\\VERS\\RandomProjects\\decompil-3ds

1. Extrait tous les zips de ce dossier dans <decompil-3ds>/ (ils contiennent local/...).
2. Recolle les gros fichiers coupés en morceaux (.part001, .part002...) puis supprime les morceaux.
3. Vérifie la taille et le SHA-256 de chaque fichier d'après manifeste.json.
"""
import glob
import hashlib
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 22), b''):
            h.update(block)
    return h.hexdigest()


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    target = os.path.abspath(sys.argv[1])
    local = os.path.join(target, 'local')
    manifest = json.load(open(os.path.join(HERE, 'manifeste.json'), encoding='utf-8'))
    zips = sorted(glob.glob(os.path.join(HERE, 'decompil-local-*.zip')))
    for name in zips:
        print('extraction de', os.path.basename(name), flush=True)
        with zipfile.ZipFile(name) as z:
            z.extractall(target)
    for rel, count in manifest['split'].items():
        out = os.path.join(local, rel)
        print('recollage de', rel, flush=True)
        with open(out, 'wb') as dst:
            for i in range(1, count + 1):
                part = '%s.part%03d' % (out, i)
                with open(part, 'rb') as src:
                    for block in iter(lambda: src.read(1 << 22), b''):
                        dst.write(block)
        for i in range(1, count + 1):
            os.remove('%s.part%03d' % (out, i))
    bad = 0
    for rel, info in manifest['files'].items():
        path = os.path.join(local, rel)
        if not os.path.isfile(path) or os.path.getsize(path) != info['size'] or sha256(path) != info['sha256']:
            print('ERREUR :', rel)
            bad += 1
    print('%d fichiers vérifiés, %d erreurs' % (len(manifest['files']), bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
