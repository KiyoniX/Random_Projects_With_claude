"""Profileur par échantillons du portage, sans droits d'administrateur (Windows) : lance une commande, et environ 1 000 fois
par seconde suspend le fil qui a pris le plus de temps processeur, déroule sa pile (dbghelp StackWalk64, avec les tables de
déroulage des modules), puis la garde. Les noms viennent ensuite de llvm-symbolizer (PDB de portage.exe et de runtime.exe,
symboles de jeu-hote.dll).

    python -I outils/profil.py prendre SORTIE EXE ARGS...     écrit SORTIE.brut (piles et modules)
    python -I outils/profil.py lire SORTIE.brut [MOTIF ...]    feuilles et temps inclusif, ou les appelants de MOTIF
    python outils/profil.py test

Exemple : `prendre local/analyse/rendu/opti/p portage/target/release/portage.exe play --rejouer J --aller-a 99999
--seconds 60` (fenêtre cachée, pleine vitesse). Le fil suivi est relu chaque seconde ; une pile dont le déroulage échoue
garde au moins son adresse courante.
"""
import collections
import ctypes
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
    dbg.SymInitializeW(w.HANDLE(hproc), None, True)
    poignees, piles, mods, suivi, releve = {}, collections.Counter(), {}, None, 0
    while p.poll() is None:
        if time.time() - releve > 1:
            for t in fils(p.pid):
                if t not in poignees:
                    h = k32.OpenThread(0x0002 | 0x0008 | 0x0010 | 0x0040, False, t)
                    if h:
                        poignees[t] = h
            plus = 0
            for t, h in poignees.items():
                a, b, c, u = (w.FILETIME(), w.FILETIME(), w.FILETIME(), w.FILETIME())
                k32.GetThreadTimes(w.HANDLE(h), ctypes.byref(a), ctypes.byref(b), ctypes.byref(c), ctypes.byref(u))
                v = (u.dwHighDateTime << 32) | u.dwLowDateTime
                if v > plus:
                    plus, suivi = v, t
            for m in modules(hproc):
                mods[m[0]] = m
            dbg.SymRefreshModuleList(w.HANDLE(hproc))
            releve = time.time()
        h = poignees.get(suivi)
        if h and k32.SuspendThread(w.HANDLE(h)) != 0xFFFFFFFF:
            pile = derouler(hproc, h)
            k32.ResumeThread(w.HANDLE(h))
            if pile:
                piles[pile] += 1
        time.sleep(0.001)
    with open(sortie + '.brut', 'wb') as f:
        pickle.dump((piles, mods), f)
    print(sum(piles.values()), 'piles ->', sortie + '.brut')


def symboles(piles, mods):
    """Les piles en noms : une liste de (noms de la feuille vers le bas, nombre)."""
    liste = sorted(mods.values())

    def module(v):
        return next(((b, n) for b, t, n in liste if b <= v < b + t), (0, '?'))
    # une adresse de retour pointe après l'appel : on demande le nom de l'octet d'avant
    voulu = collections.defaultdict(set)
    for pile in piles:
        for i, v in enumerate(pile):
            b, n = module(v)
            if os.path.basename(n).lower() in NOMMES:
                voulu[n].add(v - b - (1 if i else 0))
    noms = {}
    for n, adresses in voulu.items():
        cles = sorted(adresses)
        sortie = subprocess.run(['llvm-symbolizer', '--obj', n, '--no-inlines', '--demangle', '--relative-address'],
                                input='\n'.join(hex(a) for a in cles), capture_output=True, text=True).stdout
        for a, bloc in zip(cles, sortie.strip().split('\n\n')):
            noms[(n, a)] = bloc.strip().split('\n')[0][:110]

    def nom(v, i):
        b, n = module(v)
        if os.path.basename(n).lower() not in NOMMES:
            return os.path.basename(n)
        return noms.get((n, v - b - (1 if i else 0)), '?')
    return [([nom(v, i) for i, v in enumerate(pile)], c) for pile, c in piles.items()]


def resume(nommees, motifs=(), lignes=40):
    """Le texte du rapport : feuilles et inclusif, ou pour chaque motif les chaînes d'appel (5 noms) qui y mènent."""
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
    nommees = [(['memcpy', 'draw', 'run'], 3), (['submit', 'run'], 1)]
    texte = resume(nommees)
    assert '4 piles' in texte and ' 75.00 %  memcpy' in texte and '100.00 %  run' in texte, texte
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
