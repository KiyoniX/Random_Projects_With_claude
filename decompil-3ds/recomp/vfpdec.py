"""La VFPv2 de l'ARM11 : transferts mémoire, arithmétique, conversions, transferts avec les registres du cœur.

Les registres VFP restent dans `c->vfp` (voir rt.h) : s[i] pour les bits d'un simple, f[i] pour sa valeur,
d[i] et df[i] pour les doubles. Les NaN produits sont ramenés au NaN par défaut (le mode DN du noyau de la console).
"""
from armdec import REGS, lit, _bad


def S(n):
    return 'c->vfp.f[%d]' % n


def SB(n):
    return 'c->vfp.s[%d]' % n


def D(n):
    return 'c->vfp.df[%d]' % n


def DB(n):
    return 'c->vfp.d[%d]' % n


def decode_mem(insn, ctx):
    w = insn.word
    addr = insn.addr
    cp = (w >> 8) & 15
    if cp not in (10, 11):
        return _bad(insn, 'ldc/stc coprocesseur %d' % cp)
    dbl = cp == 11
    if (w & 0x0FE00000) == 0x0C400000:                  # transferts de deux registres
        return _two_regs(insn, ctx, dbl)
    P, U, Dd, W, L = [(w >> s) & 1 for s in (24, 23, 22, 21, 20)]
    rn = (w >> 16) & 15
    vd = (w >> 12) & 15
    imm8 = w & 0xFF
    if P and not W:                                      # VLDR, VSTR
        idx = (vd << 1 | Dd) if not dbl else (Dd << 4 | vd)
        if dbl and Dd:
            return _bad(insn, 'd16-d31 (VFPv3)')
        base = lit(addr + 8) if rn == 15 else REGS[rn]
        off = imm8 * 4
        ea = '%s %s %du' % (base, '+' if U else '-', off)
        if rn == 15 and ctx.image is not None:
            ea = lit((addr + 8 + (off if U else -off)) & 0xFFFFFFFF)
        insn.mnem = ('vldr' if L else 'vstr')
        if dbl:
            if L:
                insn.lines = ['u32 ea = %s;' % ea, '%s = (u64)rd32(ea) | ((u64)rd32(ea + 4) << 32);' % DB(idx)]
            else:
                insn.lines = ['u32 ea = %s;' % ea, 'wr32(ea, (u32)%s); wr32(ea + 4, (u32)(%s >> 32));' % (DB(idx), DB(idx))]
        else:
            insn.lines = (['u32 ea = %s;' % ea, '%s = rd32(ea);' % SB(idx)] if L else
                          ['u32 ea = %s;' % ea, 'wr32(ea, %s);' % SB(idx)])
        return insn
    # VLDM / VSTM / VPUSH / VPOP
    if (not P and not U and not W) or (P == U):
        return _bad(insn, 'vldm/vstm mode non permis')
    if P and not W and False:
        pass
    if rn == 15:
        return _bad(insn, 'vldm pc')
    words = imm8
    if dbl and Dd:
        return _bad(insn, 'd16-d31 (VFPv3)')
    first = (vd << 1 | Dd) if not dbl else (Dd << 4 | vd)
    count_regs = words // 2 if dbl else words
    if count_regs == 0 or first + (count_regs * (2 if dbl else 1)) > 32 or (dbl and count_regs > 16):
        return _bad(insn, 'vldm liste')
    base = REGS[rn]
    L_ = ['u32 base = %s;' % base]
    if U:
        L_.append('u32 a = base;')
        newb = 'base + %du' % (4 * words)
    else:
        L_.append('u32 a = base - %du;' % (4 * words))
        newb = 'base - %du' % (4 * words)
    insn.mnem = 'vldm' if L else 'vstm'
    for k in range(count_regs):
        if dbl:
            i = first // 2 + k if False else (Dd << 4 | vd) + k
            if L:
                L_.append('%s = (u64)rd32(a + %d) | ((u64)rd32(a + %d) << 32);' % (DB(i), 8 * k, 8 * k + 4))
            else:
                L_.append('wr32(a + %d, (u32)%s); wr32(a + %d, (u32)(%s >> 32));' % (8 * k, DB(i), 8 * k + 4, DB(i)))
        else:
            i = first + k
            L_.append(('%s = rd32(a + %d);' % (SB(i), 4 * k)) if L else ('wr32(a + %d, %s);' % (4 * k, SB(i))))
    if W:
        L_.append('%s = %s;' % (base, newb))
    insn.lines = L_
    return insn


def _two_regs(insn, ctx, dbl):
    w = insn.word
    L = (w >> 20) & 1
    rt, rt2 = (w >> 12) & 15, (w >> 16) & 15
    if 15 in (rt, rt2):
        return _bad(insn, 'vmov deux registres avec pc')
    m = (w & 15) << 1 | ((w >> 5) & 1) if not dbl else ((w >> 5) & 1) << 4 | (w & 15)
    if (w & 0xD0) != 0x10:
        return _bad(insn, 'transfert de deux registres non couvert')
    insn.mnem = 'vmov'
    if dbl:
        if (w >> 5) & 1:
            return _bad(insn, 'd16-d31 (VFPv3)')
        if L:
            insn.lines = ['%s = (u32)%s; %s = (u32)(%s >> 32);' % (REGS[rt], DB(m), REGS[rt2], DB(m))]
        else:
            insn.lines = ['%s = (u64)%s | ((u64)%s << 32);' % (DB(m), REGS[rt], REGS[rt2])]
    else:
        if m >= 31:
            return _bad(insn, 'vmov deux simples')
        if L:
            insn.lines = ['%s = %s; %s = %s;' % (REGS[rt], SB(m), REGS[rt2], SB(m + 1))]
        else:
            insn.lines = ['%s = %s; %s = %s;' % (SB(m), REGS[rt], SB(m + 1), REGS[rt2])]
    return insn


def decode_reg(insn, ctx):
    w = insn.word
    cp = (w >> 8) & 15
    dbl = cp == 11
    if (w >> 24) & 15 != 14:
        return _bad(insn, 'vfp : coprocesseur')
    if w & 0x10:
        return _transfer(insn, ctx)
    return _arith(insn, ctx, dbl)


def _transfer(insn, ctx):
    w = insn.word
    L = (w >> 20) & 1
    rt = (w >> 12) & 15
    cp = (w >> 8) & 15
    if (w & 0x00E00F7F) == 0x00000A10:                    # VMOV Sn, Rt / VMOV Rt, Sn
        vn = ((w >> 16) & 15) << 1 | ((w >> 7) & 1)
        if rt == 15:
            return _bad(insn, 'vmov pc')
        insn.mnem = 'vmov'
        insn.lines = ['%s = %s;' % (REGS[rt], SB(vn))] if L else ['%s = %s;' % (SB(vn), REGS[rt])]
        return insn
    if (w & 0x0FEF0FFF) == 0x0EE10A10:                    # VMSR FPSCR / VMRS FPSCR
        reg = (w >> 16) & 15
        if reg == 1:
            if (w >> 20) & 1:
                insn.mnem = 'vmrs'
                if rt == 15:
                    insn.mnem = 'fmstat'
                    insn.lines = ['nf = c->fpscr >> 31; zf = (c->fpscr >> 30) & 1u; cf = (c->fpscr >> 29) & 1u; '
                                  'vf = (c->fpscr >> 28) & 1u;']
                else:
                    insn.lines = ['%s = c->fpscr;' % REGS[rt]]
            else:
                if rt == 15:
                    return _bad(insn, 'vmsr pc')
                insn.mnem = 'vmsr'
                insn.lines = ['c->fpscr = %s; rt_fp_setup(c->fpscr);' % REGS[rt]]
            return insn
        if reg == 8 and rt != 15:
            insn.mnem = 'vmrs' if (w >> 20) & 1 else 'vmsr'
            insn.lines = ['%s = c->fpexc;' % REGS[rt]] if (w >> 20) & 1 else ['c->fpexc = %s;' % REGS[rt]]
            return insn
    return _bad(insn, 'transfert vfp non couvert')


def _arith(insn, ctx, dbl):
    w = insn.word
    p, q, r, s = (w >> 23) & 1, (w >> 21) & 1, (w >> 20) & 1, (w >> 6) & 1
    opc = p << 2 | q << 1 | r
    vd_, vn_, vm_ = (w >> 12) & 15, (w >> 16) & 15, w & 15
    Dd, N, M = (w >> 22) & 1, (w >> 7) & 1, (w >> 5) & 1
    # Les conversions mélangent les tailles (un double d'un côté, un simple de l'autre) : D et M y désignent un simple
    # (le bit de poids faible de Sd ou Sm), pas un registre d16-d31. Chaque branche de conversion contrôle le sien.
    mixed = dbl and opc == 7 and vn_ in (7, 8, 12, 13)
    if dbl:
        if not mixed and (Dd or M or (N and opc != 7)):          # pour les opérations « étendues », N fait partie du code opération
            return _bad(insn, 'd16-d31 (VFPv3)')
        d, n, m = vd_, vn_, vm_
        R = D
        ty, cast = 'double', 'double'
        canon = 'dcanon'
    else:
        d, n, m = vd_ << 1 | Dd, vn_ << 1 | N, vm_ << 1 | M
        R = S
        ty, canon = 'float', 'fcanon'
    if opc in (0, 1, 2, 3, 4):
        names = {0: ('vmla', 'vmls'), 1: ('vnmls', 'vnmla'), 2: ('vmul', 'vnmul'), 3: ('vadd', 'vsub'), 4: ('vdiv', None)}
        name = names[opc][s]
        if name is None:
            return _bad(insn, 'opération vfp inconnue')
        insn.mnem = name
        fd, fn, fm = R(d), R(n), R(m)
        e = {'vmla': '%s + %s * %s' % (fd, fn, fm), 'vmls': '%s - %s * %s' % (fd, fn, fm),
             'vnmls': '-%s + %s * %s' % (fd, fn, fm), 'vnmla': '-%s - %s * %s' % (fd, fn, fm),
             'vmul': '%s * %s' % (fn, fm), 'vnmul': '-(%s * %s)' % (fn, fm), 'vadd': '%s + %s' % (fn, fm),
             'vsub': '%s - %s' % (fn, fm), 'vdiv': '%s / %s' % (fn, fm)}[name]
        # le produit est arrondi avant l'addition : pas de fusion (compilé avec -ffp-contract=off)
        if name == 'vnmul':       # le NaN par défaut est produit par la multiplication, puis la négation s'applique
            insn.lines = ['%s r = %s(%s * %s);' % (ty, canon, fn, fm), '%s = -r;' % fd]
        else:
            insn.lines = ['%s r = %s;' % (ty, e), '%s = %s(r);' % (fd, canon)]
        return insn
    if opc != 7:
        return _bad(insn, 'opération vfp non couverte')
    ext = vn_
    low = (w >> 6) & 3
    if ext == 0 and low == 1:
        insn.mnem = 'vmov'
        insn.lines = ['%s = %s;' % ((DB(d), DB(m)) if dbl else (SB(d), SB(m)))]
        return insn
    if ext == 0 and low == 3:
        insn.mnem = 'vabs'
        insn.lines = ['%s = %s & 0x%s;' % ((DB(d), DB(m), '7fffffffffffffffull') if dbl else (SB(d), SB(m), '7fffffffu'))]
        return insn
    if ext == 1 and low == 1:
        insn.mnem = 'vneg'
        insn.lines = ['%s = %s ^ 0x%s;' % ((DB(d), DB(m), '8000000000000000ull') if dbl else (SB(d), SB(m), '80000000u'))]
        return insn
    if ext == 1 and low == 3:
        insn.mnem = 'vsqrt'
        insn.lines = ['%s r = %s(%s);' % (ty, '__builtin_sqrt' if dbl else '__builtin_sqrtf', R(m)),
                      '%s = %s(r);' % (R(d), canon)]
        return insn
    if ext in (4, 5) and (low & 1):
        e_flag = low == 3
        insn.mnem = 'vcmpe' if e_flag else 'vcmp'
        other = '0.0' if ext == 5 else R(m)
        insn.lines = ['%s x = %s, y = %s;' % (ty, R(d), other),
                      'c->fpscr = (c->fpscr & 0x0fffffffu) | (x != x || y != y ? 0x30000000u : x == y ? 0x60000000u : '
                      'x < y ? 0x80000000u : 0x20000000u);']
        return insn
    if ext == 7 and low == 3:                            # VCVT entre double et simple
        insn.mnem = 'vcvt'
        if dbl:                                          # double -> simple : Sd, Dm
            sd = vd_ << 1 | Dd
            dm = vm_ if not M else None
            if M:
                return _bad(insn, 'd16-d31 (VFPv3)')
            insn.lines = ['float r = (float)%s;' % D(dm), '%s = fcanon(r);' % S(sd)]
        else:                                            # simple -> double : Dd, Sm
            if Dd:
                return _bad(insn, 'd16-d31 (VFPv3)')
            insn.lines = ['double r = (double)%s;' % S(vm_ << 1 | M), '%s = dcanon(r);' % D(vd_)]
        return insn
    if ext == 8 and (low & 1):                           # VCVT entier -> flottant
        signed = (w >> 7) & 1
        insn.mnem = 'vcvt'
        src = '(s32)%s' % SB(vm_ << 1 | M) if signed else SB(vm_ << 1 | M)
        if dbl:
            if Dd:
                return _bad(insn, 'd16-d31 (VFPv3)')
            insn.lines = ['%s = (double)(%s);' % (D(vd_), src)]
        else:
            insn.lines = ['%s = (float)(%s);' % (S(vd_ << 1 | Dd), src)]
        return insn
    if ext in (12, 13) and (low & 1):                    # VCVT flottant -> entier
        signed = ext == 13
        trunc = (w >> 7) & 1
        insn.mnem = 'vcvt' if trunc else 'vcvtr'
        if dbl:
            if M:
                return _bad(insn, 'd16-d31 (VFPv3)')
            x = D(vm_)
        else:
            x = S(vm_ << 1 | M)
        fn = ('f2s' if signed else 'f2u') + ('' if trunc else 'r')
        insn.lines = ['%s = %s((double)%s);' % (SB(vd_ << 1 | Dd), fn, x)]
        return insn
    return _bad(insn, 'opération vfp non couverte (étendue %d)' % ext)
