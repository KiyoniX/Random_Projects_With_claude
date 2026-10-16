"""Valide le recompilateur sur les fonctions du jeu : python recomp/validate.py {leaf,tree,speed} [options]

    leaf  [--n N] [--draws D] [--start I]   fonctions feuilles (ni appel, ni svc) : natif contre unicorn
    tree  [--n N] [--draws D]               aussi les fonctions dont tous les appelés sont validés
    speed                                   vitesse native contre unicorn sur quelques fonctions de calcul

Tout ce qui est produit (C, DLL, rapport) va dans local/recomp/.
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import harness  # noqa: E402
import recomp  # noqa: E402

OUT = os.path.join(recomp.LOCAL, 'recomp')


def build_subset(image, functions, selected, name, comments=None, opt='-O1', budget=True):
    """Traduit et compile les fonctions `selected` (adresses) ; rend (Native, results)."""
    fn_by_addr = {f[0]: f for f in functions}
    known = set(a | (1 if fn_by_addr[a][2] == 'thumb' else 0) for a in selected)
    limits = recomp.function_limits(functions, image)
    results = []
    for a in sorted(selected):
        addr, size, mode, _ = fn_by_addr[a]
        results.append(recomp.translate_function(addr, size, mode, image, known, comments, limits.get(addr)))
    out = os.path.join(OUT, name)
    files = recomp.write_build(out, results, per_file=300)
    import shutil
    shutil.copy(os.path.join(recomp.HERE, 'runtime', 'rt.h'), os.path.join(out, 'rt.h'))
    tc = harness.Toolchain(opt=opt)
    t0 = time.time()
    dll = tc.compile_dll([os.path.join(out, f) for f in files], os.path.join(out, 'build', name + '.dll'),
                         include_dirs=[out], budget=budget)
    print('compilation de %d fonctions : %.1f s' % (len(results), time.time() - t0))
    return harness.Native(dll), results


def game_sections(image):
    return [(s.address, s.data, s.perms) for s in image.sections]


def pointer_regions(image):
    return [(harness.HEAP + 0x1000, harness.HEAP_SIZE - 0x2000)] * 6 + \
           [(s.address, min(s.size, 0x8000)) for s in image.sections if s.name != 'text']


def locate_culprits(rig, image, result, draws=60):
    """Pour une fonction en échec : rejoue chaque instruction du corps seule, et rend celles qui divergent."""
    import armdec
    bad = []
    seen = set()
    for insn in result.insns:
        if insn.kind not in ('seq',) or insn.unimpl or insn.word in seen:
            continue
        seen.add(insn.word)
        bad_word = single_instruction_check(rig, insn.word, draws)
        if bad_word:
            bad.append((insn.addr, insn.word, bad_word))
    return bad


_single_cache = {}


def single_instruction_check(rig_game, word, draws):
    """Une instruction isolée contre unicorn (même mécanisme que les tests sur code fabriqué)."""
    import tests
    return tests.check_words([word], draws=draws)


def cmd_leaf(args, tree=False):
    n = 100
    draws = 150
    start = 0
    only = None
    i = 0
    while i < len(args):
        if args[i] == '--n':
            n = int(args[i + 1])
            i += 1
        elif args[i] == '--draws':
            draws = int(args[i + 1])
            i += 1
        elif args[i] == '--only':
            only = [int(x, 16) for x in args[i + 1].split(',')]
            i += 1
        elif args[i] == '--start':
            start = int(args[i + 1])
            i += 1
        i += 1
    image = recomp.Image.load()
    functions = recomp.load_functions()
    arm_fns = functions                        # ARM et Thumb
    known_all = set(f[0] | (1 if f[2] == 'thumb' else 0) for f in arm_fns)
    all_results = {}
    limits = recomp.function_limits(functions, image)
    modes = {f[0]: f[2] for f in functions}
    for addr, size, mode, name in arm_fns:
        all_results[addr] = recomp.translate_function(addr, size, mode, image, known_all, None, limits.get(addr))
    leaf = [a for a, r in sorted(all_results.items()) if r.leaf and r.complete and len(r.insns) >= 3]
    print('%d fonctions feuilles complètes' % len(leaf))
    selected = leaf[start:start + n] if not only else only
    tops = selected
    if tree:
        tops, selected = pick_tree(all_results, n)
        print('%d fonctions non feuilles fermées au total ; %d choisies, %d fonctions dans leurs arbres d appels' % (
            len([a for a in closed_functions(all_results) if all_results[a].callees]), len(tops), len(selected)))
    if not selected:
        print('rien à valider dans cette tranche')
        return {}
    native, results = build_subset(image, functions, selected, 'validation_tree' if tree else ('validation_one' if only else 'validation%d' % start))
    rig = harness.Rig(game_sections(image), native)
    ptrs = pointer_regions(image)
    t0 = time.time()
    verdicts = {}
    for k, a in enumerate(tops):
        verdict, info = rig.check_function(a | (1 if modes[a] == 'thumb' else 0), draws=draws, seed=a, ptr_regions=ptrs)
        verdicts[a] = (verdict, info)
        if k % 500 == 499:
            print('  %d / %d (%.0f s)' % (k + 1, len(tops), time.time() - t0), flush=True)
        if verdict == 'fail':
            print('ECHEC %08x : %s' % (a, '; '.join(info['diffs'][:3])))
    counts = {v: sum(1 for x in verdicts.values() if x[0] == v) for v in ('pass', 'fail', 'skip')}
    print('%d fonctions : %d passent, %d échouent, %d sans tirée exploitable (%.1f s)' % (
        len(tops), counts['pass'], counts['fail'], counts['skip'], time.time() - t0))
    os.makedirs(OUT, exist_ok=True)
    report = {'%08x' % a: {'verdict': v[0], 'diffs': v[1].get('diffs', []) if v[0] == 'fail' else []}
              for a, v in verdicts.items()}
    with open(os.path.join(OUT, 'validation_tree.json' if tree else 'validation%d.json' % start), 'w') as f:
        json.dump({'tree': tree, 'counts': counts, 'functions': report}, f, indent=1)
    return verdicts


def closed_functions(all_results):
    """Les fonctions entièrement traduites dont tous les appelés (de proche en proche) le sont aussi, sans aiguillage
    ni appel système : leur arbre d'appels est donc entièrement du C recompilé."""
    ok = set(a for a, r in all_results.items() if r.complete and not r.uses_dispatch and not r.uses_svc)
    changed = True
    while changed:
        changed = False
        for a in list(ok):
            if any(c not in ok for c in all_results[a].callees):
                ok.discard(a)
                changed = True
    return ok


def closure(all_results, roots):
    seen = set()
    work = list(roots)
    while work:
        a = work.pop()
        if a in seen:
            continue
        seen.add(a)
        work.extend(all_results[a].callees)
    return seen


def pick_tree(all_results, n):
    closed = closed_functions(all_results)
    inner = sorted(a for a in closed if all_results[a].callees and len(all_results[a].insns) >= 4)
    step = max(1, len(inner) // n)
    tops = inner[::step][:n]
    return tops, sorted(closure(all_results, tops))


def cmd_retry(args):
    """Rejoue avec beaucoup plus de tirées les fonctions feuilles qui n'avaient aucune tirée exploitable."""
    import glob
    draws = int(args[args.index('--draws') + 1]) if '--draws' in args else 1000
    skipped = []
    for path in glob.glob(os.path.join(OUT, 'validation[0-9]*.json')):
        data = json.load(open(path))
        skipped += [int(a, 16) for a, v in data['functions'].items() if v['verdict'] == 'skip']
    skipped.sort()
    print('%d fonctions sans tirée exploitable à rejouer (%d tirées chacune)' % (len(skipped), draws))
    image = recomp.Image.load()
    functions = recomp.load_functions()
    native, results = build_subset(image, functions, skipped, 'validation_retry')
    rig = harness.Rig(game_sections(image), native)
    ptrs = pointer_regions(image)
    counts = {'pass': 0, 'fail': 0, 'skip': 0}
    t0 = time.time()
    modes = {f[0]: f[2] for f in functions}
    for a in skipped:
        verdict, info = rig.check_function(a | (1 if modes[a] == 'thumb' else 0), draws=draws, seed=a ^ 0x5A5A,
                                           ptr_regions=ptrs)
        counts[verdict] += 1
        if verdict == 'fail':
            print('ECHEC %08x : %s' % (a, '; '.join(info['diffs'][:3])))
    print('rejouées : %d passent, %d échouent, %d restent sans tirée (%.0f s)' % (
        counts['pass'], counts['fail'], counts['skip'], time.time() - t0))


def cmd_build(args):
    """Compile tout le jeu recompilé (local/recomp/jeu) en DLL, pour mesurer le temps et la taille.

    --host : avec les fibres, la préemption coopérative et les repères (jeu-hote.dll), ce que branche banc/cpu_native.py.
    --logw : en plus, avec le journal des écritures du mode vérification (jeu-journal.dll)."""
    opt = '-O1'
    if '--opt' in args:
        opt = args[args.index('--opt') + 1]
    out = os.path.join(OUT, 'jeu')
    if not os.path.isdir(out):
        sys.exit("d'abord : python recomp/recomp.py gen --out local/recomp/jeu")
    files = sorted(f for f in os.listdir(out) if f.endswith('.c'))
    tc = harness.Toolchain(opt=opt)
    t0 = time.time()
    host = '--host' in args or '--logw' in args
    logw = '--logw' in args
    name = 'jeu-journal.dll' if logw else ('jeu-hote.dll' if host else 'jeu.dll')
    dll = tc.compile_dll([os.path.join(out, f) for f in files], os.path.join(out, 'build', name),
                         include_dirs=[out], budget=False, jobs=os.cpu_count() or 4, host=host, logw=logw)
    print('%d fichiers C compilés avec %s en %.0f s ; DLL : %.1f Mo' % (len(files), opt, time.time() - t0,
                                                                       os.path.getsize(dll) / 1e6))


def count_instructions(rig, entry, state, limit):
    """Le nombre d'instructions qu'unicorn exécute pour cet état (crochet de code : lent, sert à la mesure seulement)."""
    counter = [0]

    def hook(uc, address, size, user):
        counter[0] += 1
    handle = rig.uc.hook_add(rig.unicorn.UC_HOOK_CODE, hook)
    try:
        kind, _ = rig.run_unicorn(entry, state, limit)
    finally:
        rig.uc.hook_del(handle)
    return kind, counter[0]


def cmd_speed(args):
    """Vitesse du natif contre unicorn : les fonctions à boucle qui passent la validation, à plus de 1000 instructions."""
    import numpy as np
    image = recomp.Image.load()
    functions = recomp.load_functions()
    arm_fns = [f for f in functions if f[2] == 'arm']
    known_all = set(f[0] for f in arm_fns)
    limits = recomp.function_limits(functions, image)
    loops = []
    for addr, size, mode, name in arm_fns:
        r = recomp.translate_function(addr, size, mode, image, known_all, None, limits.get(addr))
        if r.leaf and r.complete and any(i.kind == 'branch' and i.succ and i.succ[0] <= i.addr for i in r.insns):
            loops.append(addr)
    print('%d fonctions feuilles avec boucle' % len(loops))
    cand = loops[::max(1, len(loops) // 120)][:120]
    opt = args[args.index('--opt') + 1] if '--opt' in args else '-O2'
    native, results = build_subset(image, functions, cand, 'vitesse', opt=opt, budget=False)
    rig = harness.Rig(game_sections(image), native)
    ptrs = pointer_regions(image)
    best = []
    for a in cand:
        rng = np.random.RandomState(a)
        for _ in range(40):
            state = rig.draw(rng, ptrs)
            rig.reset_memory(state)
            kind, n = count_instructions(rig, a, state, 40000)
            if kind != 'ok' or n < 1000:
                continue
            rig.reset_memory(state)
            ucode = rig.run_native(a, state)
            if ucode != 0:
                continue
            best.append((n, a, state))
            break
    best.sort(key=lambda x: -x[0])
    print('%d fonctions de calcul trouvées' % len(best))
    for n, a, state in best[:3]:
        # on mesure l'exécution seule : unicorn repart d'un contexte gardé, le natif d'une copie de la structure Cpu
        import ctypes
        rig.reset_memory(state)
        rig.setup_unicorn(state)
        context = rig.uc.context_save()
        reps_u = max(5, int(3e6 // n))
        t0 = time.perf_counter()
        for _ in range(reps_u):
            rig.uc.context_restore(context)
            rig.emulate(a, 40000)
        tu = (time.perf_counter() - t0) / reps_u
        rig.setup_native(state)
        saved = harness.CpuStruct.from_buffer_copy(rig.cpu)
        reps_n = max(500, int(3e8 // n))
        t0 = time.perf_counter()
        for _ in range(reps_n):
            ctypes.memmove(ctypes.addressof(rig.cpu), ctypes.addressof(saved), ctypes.sizeof(saved))
            rig.native.call(rig.cpu, a)
        tn = (time.perf_counter() - t0) / reps_n
        print('%08x  %6d instructions : unicorn %8.1f us (%5.1f M instr/s), natif %7.2f us (%7.1f M instr/s), x%.0f' % (
            a, n, tu * 1e6, n / tu / 1e6, tn * 1e6, n / tn / 1e6, tu / tn))


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'leaf'
    if cmd == 'leaf':
        cmd_leaf(sys.argv[2:])
    elif cmd == 'retry':
        cmd_retry(sys.argv[2:])
    elif cmd == 'build':
        cmd_build(sys.argv[2:])
    elif cmd == 'speed':
        cmd_speed(sys.argv[2:])
    elif cmd == 'tree':
        cmd_leaf(sys.argv[2:], tree=True)
    else:
        print(__doc__)
