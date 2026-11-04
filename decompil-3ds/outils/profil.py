"""Profileur par échantillons du portage, sans droits d'administrateur (Windows) : lance une commande, et environ 1 000 fois
par seconde suspend chaque fil qui a pris plus d'un dixième d'un cœur dans la seconde passée, déroule sa pile (dbghelp StackWalk64, avec les tables de
déroulage des modules), puis la garde. Les noms viennent ensuite de llvm-symbolizer (PDB de portage.exe et de runtime.exe,
symboles de jeu-hote.dll).

    python -I outils/profil.py prendre SORTIE EXE ARGS...     écrit SORTIE.brut (piles et modules)
    python -I outils/profil.py lire SORTIE.brut [MOTIF ...]    feuilles et temps inclusif, ou les appelants de MOTIF
    python outils/profil.py test

Exemple : `prendre local/analyse/rendu/opti/p portage/target/release/portage.exe play --rejouer J --aller-a 99999
--seconds 60` (fenêtre cachée, pleine vitesse). Les fils suivis sont relus chaque seconde et le rapport les sépare (par
leur nom, `GetThreadDescription`) : le fil principal et celui de l'envoi au GPU se valent presque, et mêlés, le second
(dont la pile traverse le pilote, sans tables de déroulage) faussait tout. Une pile dont le déroulage échoue garde au moins
son adresse courante.
"""
import collections
import ctypes
import json
import os
import pickle
import subprocess
import sys
import time

# les modules dont on lit les noms ; les autres (pilotes, bibliothèques du système) gardent le nom du module
NOMMES = ('portage.exe', 'runtime.exe', 'jeu-hote.dll')


def prendre(sortie, commande):
    import ctypes.wintypes as w
    k32 = ctypes.WinDLL('kernel32', use_last_error=True)
    psapi = ctypes.WinDLL('psapi')
    dbg = ctypes.WinDLL('dbghelp')
    k32.OpenThread.restype = k32.OpenProcess.restype = k32.CreateToolhelp32Snapshot.restype = w.HANDLE
    fta = ctypes.WINFUNCTYPE(ctypes.c_void_p, w.HANDLE, ctypes.c_uint64)(('SymFunctionTableAccess64', dbg))
    gmb = ctypes.WINFUNCTYPE(ctypes.c_uint64, w.HANDLE, ctypes.c_uint64)(('SymGetModuleBase64', dbg))
    dbg.StackWalk64.argtypes = [w.DWORD, w.HANDLE, w.HANDLE] + [ctypes.c_void_p] * 6

    class Fil(ctypes.Structure):  # THREADENTRY32
        _fields_ = [('dwSize', w.DWORD), ('cntUsage', w.DWORD), ('tid', w.DWORD), ('pid', w.DWORD),
                    ('base', w.LONG), ('delta', w.LONG), ('flags', w.DWORD)]

    class InfoModule(ctypes.Structure):  # MODULEINFO
        _fields_ = [('base', ctypes.c_void_p), ('size', w.DWORD), ('entry', ctypes.c_void_p)]

    def fils(pid):
        snap = k32.CreateToolhelp32Snapshot(4, 0)
        e = Fil()
        e.dwSize = ctypes.sizeof(e)
        out, ok = [], k32.Thread32First(snap, ctypes.byref(e))
        while ok:
            if e.pid == pid:
                out.append(e.tid)
            ok = k32.Thread32Next(snap, ctypes.byref(e))
        k32.CloseHandle(snap)
        return out

    def modules(hproc):
        tab, besoin, out = (ctypes.c_void_p * 1024)(), w.DWORD(), []
        psapi.EnumProcessModulesEx(w.HANDLE(hproc), tab, ctypes.sizeof(tab), ctypes.byref(besoin), 3)
        for m in tab[:besoin.value // 8]:
            nom, info = ctypes.create_unicode_buffer(1024), InfoModule()
            psapi.GetModuleFileNameExW(w.HANDLE(hproc), ctypes.c_void_p(m), nom, 1024)
            psapi.GetModuleInformation(w.HANDLE(hproc), ctypes.c_void_p(m), ctypes.byref(info), ctypes.sizeof(info))
            if info.base:
                out.append((info.base, info.size, nom.value))
        return out

    tampon = (ctypes.c_char * (1232 + 16))()
    contexte = (ctypes.addressof(tampon) + 15) & ~15  # CONTEXT x64, aligné sur 16
    cadre = (ctypes.c_char * 0x300)()  # STACKFRAME64

    def derouler(hproc, h):
        ctypes.memset(contexte, 0, 1232)
        ctypes.c_uint32.from_address(contexte + 0x30).value = 0x10000B  # CONTEXT_FULL
        if not k32.GetThreadContext(w.HANDLE(h), ctypes.c_void_p(contexte)):
            return None
        ctypes.memset(cadre, 0, 0x300)
        f = ctypes.addressof(cadre)
        rip = ctypes.c_uint64.from_address(contexte + 0xF8).value
        for champ, registre in ((0, 0xF8), (0x20, 0xA0), (0x30, 0x98)):  # AddrPC, AddrFrame, AddrStack
            ctypes.c_uint64.from_address(f + champ).value = ctypes.c_uint64.from_address(contexte + registre).value
            ctypes.c_uint32.from_address(f + champ + 0xC).value = 3  # AddrModeFlat
        pile = []
        for _ in range(48):
            if not dbg.StackWalk64(0x8664, w.HANDLE(hproc), w.HANDLE(h), f, contexte, None, fta, gmb, None):
                break
            pc = ctypes.c_uint64.from_address(f).value
            if not pc:
                break
            pile.append(pc)
        return tuple(pile) or (rip,)

    p = subprocess.Popen(commande, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    hproc = k32.OpenProcess(0x1F0FFF, False, p.pid)
    dbg.SymSetOptions(0x4 | 0x2)  # chargements différés, noms non décorés
    # SymInitialize échoue tant que le processus n'a pas fini de démarrer, et sans lui dbghelp n'a pas les tables de
    # déroulage : les piles s'arrêtent alors après un ou deux appels. Il est retenté à chaque relevé.
    pret = False
    k32.GetThreadDescription.argtypes = [w.HANDLE, ctypes.POINTER(ctypes.c_wchar_p)]

    def nom_du_fil(h, t):
        texte = ctypes.c_wchar_p()
        k32.GetThreadDescription(w.HANDLE(h), ctypes.byref(texte))
        nom = texte.value or f'fil {t}'
        k32.LocalFree(texte)
        return nom

    def temps(h):
        a, b, c, u = (w.FILETIME(), w.FILETIME(), w.FILETIME(), w.FILETIME())
        k32.GetThreadTimes(w.HANDLE(h), ctypes.byref(a), ctypes.byref(b), ctypes.byref(c), ctypes.byref(u))
        return sum((x.dwHighDateTime << 32) | x.dwLowDateTime for x in (c, u))  # noyau + utilisateur, en 100 ns

    poignees, piles, mods, suivis, avant, releve = {}, collections.Counter(), {}, [], {}, 0
    while p.poll() is None:
        if time.time() - releve > 1:
            for t in fils(p.pid):
                if t not in poignees:
                    h = k32.OpenThread(0x0002 | 0x0008 | 0x0010 | 0x0040, False, t)
                    if h:
                        poignees[t] = h
            ecoule = (time.time() - releve) * 1e7 if releve else 0
            maintenant = {t: temps(h) for t, h in poignees.items()}
            suivis = [(t, nom_du_fil(poignees[t], t)) for t, v in maintenant.items()
                      if ecoule and v - avant.get(t, v) > ecoule / 10]
            avant = maintenant
            for m in modules(hproc):
                mods[m[0]] = m
            if pret:
                dbg.SymRefreshModuleList(w.HANDLE(hproc))
            else:
                pret = bool(dbg.SymInitializeW(w.HANDLE(hproc), None, True))
            releve = time.time()
        for t, nom in (suivis if pret else []):
            h = poignees[t]
            if k32.SuspendThread(w.HANDLE(h)) != 0xFFFFFFFF:
                pile = derouler(hproc, h)
                k32.ResumeThread(w.HANDLE(h))
                if pile:
                    piles[(nom, pile)] += 1
        time.sleep(0.001)
    with open(sortie + '.brut', 'wb') as f:
        pickle.dump((piles, mods), f)
    if not pret:
        print('dbghelp ne s\'est jamais initialisé (SymInitialize) : aucune pile prise')
    print(sum(piles.values()), 'piles ->', sortie + '.brut')


def symboles(piles, mods):
    """Les piles en noms : une liste de (fil, noms de la feuille vers le bas, nombre)."""
    liste = sorted(mods.values())

    def module(v):
        return next(((b, n) for b, t, n in liste if b <= v < b + t), (0, '?'))
    # une adresse de retour pointe après l'appel : on demande le nom de l'octet d'avant
    voulu = collections.defaultdict(set)
    for _, pile in piles:
        for i, v in enumerate(pile):
            b, n = module(v)
            if os.path.basename(n).lower() in NOMMES:
                voulu[n].add(v - b - (1 if i else 0))
    noms = {}
    for n, adresses in voulu.items():
        cles = sorted(adresses)
        # une ligne JSON par adresse : la sortie en texte se découpe mal (un nom vide n'y laisse pas de ligne)
        sortie = subprocess.run(['llvm-symbolizer', '--obj', n, '--no-inlines', '--demangle', '--relative-address',
                                 '--output-style=JSON'], input='\n'.join(hex(a) for a in cles), capture_output=True,
                                text=True).stdout
        for ligne in sortie.splitlines():
            r = json.loads(ligne)
            noms[(n, int(r['Address'], 16))] = (r['Symbol'][0]['FunctionName'] if r.get('Symbol') else '')[:110] or '?'

    def nom(v, i):
        b, n = module(v)
        if os.path.basename(n).lower() not in NOMMES:
            return os.path.basename(n)
        return noms.get((n, v - b - (1 if i else 0)), '?')
    return [(fil, [nom(v, i) for i, v in enumerate(pile)], c) for (fil, pile), c in piles.items()]


def resume(nommees, motifs=(), lignes=40):
    """Le texte du rapport, fil par fil (le plus vu d'abord) : feuilles et inclusif, ou pour chaque motif les chaînes
    d'appel (5 noms) qui y mènent."""
    par_fil = collections.defaultdict(list)
    for fil, ch, c in nommees:
        par_fil[fil].append((ch, c))
    ordre = sorted(par_fil, key=lambda f: -sum(c for _, c in par_fil[f]))
    return '\n\n'.join(f'=== {fil}\n' + resume_fil(par_fil[fil], motifs, lignes) for fil in ordre)


def resume_fil(nommees, motifs, lignes):
    total = sum(c for _, c in nommees) or 1
    out = [f'{total} piles']

    def bloc(titre, compte):
        out.append('--- ' + titre)
        out.extend(f'{100 * c / total:6.2f} %  {k}' for k, c in compte.most_common(lignes))
    if not motifs:
        feuilles, inclusif = collections.Counter(), collections.Counter()
        for ch, c in nommees:
            feuilles[ch[0]] += c
            for x in set(ch):
                inclusif[x] += c
        bloc('feuilles', feuilles)
        bloc('inclusif (la fonction ou ce qu\'elle appelle)', inclusif)
    for motif in motifs:
        chaines = collections.Counter()
        for ch, c in nommees:
            i = next((i for i, x in enumerate(ch) if motif in x), None)
            if i is not None:
                chaines[' <- '.join(ch[i:i + 5])] += c
        bloc('appelants de ' + motif, chaines)
    return '\n'.join(out)


def test():
    nommees = [('principal', ['memcpy', 'draw', 'run'], 3), ('principal', ['submit', 'run'], 1), ('envoi', ['finish'], 1)]
    texte = resume(nommees)
    assert texte.index('=== principal') < texte.index('=== envoi'), texte
    assert '4 piles' in texte and ' 75.00 %  memcpy' in texte and '100.00 %  run' in texte, texte
    assert '100.00 %  finish' in texte.split('=== envoi')[1], texte
    appel = resume(nommees, ['draw'])
    assert ' 75.00 %  draw <- run' in appel and 'submit' not in appel, appel
    print('profil : tests ok')


def main():
    arg = sys.argv[1:]
    if arg[:1] == ['prendre'] and len(arg) > 2:
        prendre(arg[1], arg[2:])
    elif arg[:1] == ['lire'] and len(arg) > 1:
        with open(arg[1], 'rb') as f:
            piles, mods = pickle.load(f)
        print(resume(symboles(piles, mods), arg[2:]))
    elif arg[:1] == ['test']:
        test()
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main()
