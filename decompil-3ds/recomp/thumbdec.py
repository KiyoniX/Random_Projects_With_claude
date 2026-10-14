"""Le décodeur Thumb (Thumb-1 de l'ARMv6, sans IT) : un ou deux demi-mots -> des lignes de C.

Même interface que armdec : `decode(addr, ctx, image)` rend un `Insn` (taille 2, ou 4 pour la paire BL/BLX).
Les registres sont les mêmes variables locales ; presque toutes les instructions de calcul posent les drapeaux.
Les clés de `ctx.known` des fonctions Thumb sont leur adresse avec le bit 0 à 1.
"""
from armdec import REGS, Insn, M32, lit, ror, sext

COND_RAW = 14       # « toujours » (cond n'est tenu que pour les branchements conditionnels)


def _flags_nz(reg):
    return 'nf = t >> 31; zf = (t == 0);'


def _bad(insn, why):
    insn.unimpl = why
    insn.lines = []
    insn.succ = []
    insn.fall = False
    insn.kind = 'seq'
    return insn


def decode(addr, ctx, image):
    hw = image.half(addr)
    insn = Insn(addr, hw or 0)
    insn.size = 2
    insn.thumb = True
    insn.cond = 14
    if hw is None:
        return _bad(insn, 'hors du code')
    top = hw >> 11
    if top < 3:                                             # 000xx : décalages immédiats
        return _shift_imm(insn, hw)
    if top == 3:                                            # 00011 : add / sub
        return _addsub(insn, hw)
    if top < 8:                                             # 001xx : mov cmp add sub immédiats
        return _imm8(insn, hw)
    if hw >> 10 == 0x10:                                    # 010000 : ALU
        return _alu(insn, hw)
    if hw >> 10 == 0x11:                                    # 010001 : registres hauts et bx
        return _hireg(insn, hw, ctx)
    if top == 9:                                            # 01001 : ldr pc-relatif
        rd = (hw >> 8) & 7
        ea = ((addr + 4) & ~3) + (hw & 0xFF) * 4
        insn.mnem = 'ldr'
        val = ctx.image.const32(ea) if ctx.image is not None else None
        insn.lines = ['%s = %s;' % (REGS[rd], lit(val))] if val is not None else \
            ['%s = rd32(%s);' % (REGS[rd], lit(ea))]
        return insn
    if hw >> 12 == 5:                                       # 0101 : accès avec registre offset
        return _ldst_reg(insn, hw)
    if hw >> 13 == 3:                                       # 011 : ldr str immédiat
        return _ldst_imm(insn, hw)
    if hw >> 12 == 8:                                       # 1000 : ldrh strh immédiat
        rd, rb, off = hw & 7, (hw >> 3) & 7, ((hw >> 6) & 31) * 2
        if (hw >> 11) & 1:
            insn.mnem = 'ldrh'
            insn.lines = ['%s = rd16(%s + %du);' % (REGS[rd], REGS[rb], off)]
        else:
            insn.mnem = 'strh'
            insn.lines = ['wr16(%s + %du, %s);' % (REGS[rb], off, REGS[rd])]
        return insn
    if hw >> 12 == 9:                                       # 1001 : ldr str relatifs à sp
        rd, off = (hw >> 8) & 7, (hw & 0xFF) * 4
        if (hw >> 11) & 1:
            insn.mnem = 'ldr'
            insn.lines = ['%s = rd32(sp + %du);' % (REGS[rd], off)]
        else:
            insn.mnem = 'str'
            insn.lines = ['wr32(sp + %du, %s);' % (off, REGS[rd])]
        return insn
    if hw >> 12 == 10:                                      # 1010 : add rd, pc/sp, #imm
        rd, off = (hw >> 8) & 7, (hw & 0xFF) * 4
        insn.mnem = 'add'
        if (hw >> 11) & 1:
            insn.lines = ['%s = sp + %du;' % (REGS[rd], off)]
        else:
            insn.lines = ['%s = %s;' % (REGS[rd], lit(((addr + 4) & ~3) + off))]
        return insn
    if hw >> 12 == 11:
        return _misc(insn, hw, ctx)
    if hw >> 12 == 12:                                      # 1100 : ldmia stmia
        return _ldmstm(insn, hw)
    if hw >> 12 == 13:                                      # 1101 : branchement conditionnel, svc
        cond = (hw >> 8) & 15
        if cond == 15:
            insn.mnem = 'svc'
            insn.kind = 'svc'
            insn.lines = ['RT_SAVE(); rt_svc(c, 0x%x, %s); RT_LOAD();' % (hw & 0xFF, lit(addr + 2))]
            return insn
        if cond == 14:
            return _bad(insn, 'udf')
        target = (addr + 4 + (sext(hw, 8) << 1)) & M32
        return _branch(insn, ctx, target, cond)
    if top == 28:                                           # 11100 : b
        target = (addr + 4 + (sext(hw, 11) << 1)) & M32
        return _branch(insn, ctx, target, 14)
    if (hw >> 11) == 30:                                    # 11110 : première moitié de bl / blx
        return _bl(insn, hw, ctx, image)
    return _bad(insn, 'thumb non couvert')


def _branch(insn, ctx, target, cond):
    insn.mnem = 'b'
    insn.cond = cond
    if ctx.claim(target):
        insn.lines = ['%sgoto L_%08x;' % ('RT_BACKEDGE(); ' if target <= insn.addr else '', target)]
        insn.succ = [target]
        insn.kind = 'branch'
        return insn.stop()
    insn.kind = 'tail'
    ctx.callees.add(target & ~1)
    if (target | 1) in ctx.known:
        insn.lines = ['RT_SAVE(); f_%08x(c); return;' % target]
    else:
        insn.lines = ['RT_SAVE(); rt_dispatch(c, %s); return;' % lit(target | 1)]
    return insn.stop()


def _bl(insn, hw, ctx, image):
    hw2 = image.half(insn.addr + 2)
    insn.size = 4
    if hw2 is None or (hw2 >> 11) not in (31, 29):
        return _bad(insn, 'bl sans seconde moitié')
    insn.word = hw | (hw2 << 16)
    off = (sext(hw, 11) << 12) | ((hw2 & 0x7FF) << 1)
    target = (insn.addr + 4 + off) & M32
    blx = (hw2 >> 11) == 29
    if blx:
        target &= ~3
    insn.mnem = 'blx' if blx else 'bl'
    insn.kind = 'call'
    key = target if blx else (target | 1)
    lines = ['lr = %s;' % lit((insn.addr + 4) | 1)]
    ctx.callees.add(target & ~1)
    if key in ctx.known:
        lines.append('RT_SAVE(); f_%08x(c); RT_LOAD();' % target)
    else:
        lines.append('RT_SAVE(); rt_dispatch(c, %s); RT_LOAD();' % lit(key))
    insn.lines = lines
    return insn


def _shift_imm(insn, hw):
    op = (hw >> 11) & 3
    imm = (hw >> 6) & 31
    rs, rd = (hw >> 3) & 7, hw & 7
    x = REGS[rs]
    insn.mnem = ['lsl', 'lsr', 'asr'][op]
    if op == 0:
        if imm == 0:
            insn.lines = ['u32 t = %s;' % x, '%s = t;' % REGS[rd], _flags_nz(rd)]
        else:
            insn.lines = ['u32 t = %s << %d;' % (x, imm), 'cf = (%s >> %d) & 1u;' % (x, 32 - imm),
                          '%s = t;' % REGS[rd], _flags_nz(rd)]
    elif op == 1:
        if imm == 0:
            insn.lines = ['u32 t = 0;', 'cf = %s >> 31;' % x, '%s = t;' % REGS[rd], _flags_nz(rd)]
        else:
            insn.lines = ['u32 t = %s >> %d;' % (x, imm), 'cf = (%s >> %d) & 1u;' % (x, imm - 1),
                          '%s = t;' % REGS[rd], _flags_nz(rd)]
    else:
        if imm == 0:
            insn.lines = ['u32 t = (u32)((s32)%s >> 31);' % x, 'cf = %s >> 31;' % x, '%s = t;' % REGS[rd], _flags_nz(rd)]
        else:
            insn.lines = ['u32 t = (u32)((s32)%s >> %d);' % (x, imm), 'cf = (%s >> %d) & 1u;' % (x, imm - 1),
                          '%s = t;' % REGS[rd], _flags_nz(rd)]
    return insn


def _addsub(insn, hw):
    imm = (hw >> 10) & 1
    sub = (hw >> 9) & 1
    rn_or_imm = (hw >> 6) & 7
    rs, rd = (hw >> 3) & 7, hw & 7
    b = ('%du' % rn_or_imm) if imm else REGS[rn_or_imm]
    insn.mnem = 'sub' if sub else 'add'
    if sub:
        insn.lines = ['u32 b = %s;' % b, 'u32 t = add_flags(%s, ~b, 1u, &cf, &vf);' % REGS[rs], '%s = t;' % REGS[rd],
                      _flags_nz(rd)]
    else:
        insn.lines = ['u32 b = %s;' % b, 'u32 t = add_flags(%s, b, 0u, &cf, &vf);' % REGS[rs], '%s = t;' % REGS[rd],
                      _flags_nz(rd)]
    return insn


def _imm8(insn, hw):
    op = (hw >> 11) & 3
    rd, imm = (hw >> 8) & 7, hw & 0xFF
    insn.mnem = ['mov', 'cmp', 'add', 'sub'][op]
    r = REGS[rd]
    if op == 0:
        insn.lines = ['u32 t = %du;' % imm, '%s = t;' % r, _flags_nz(rd)]
    elif op == 1:
        insn.lines = ['u32 b = %du;' % imm, 'u32 t = add_flags(%s, ~b, 1u, &cf, &vf);' % r, _flags_nz(rd)]
    elif op == 2:
        insn.lines = ['u32 b = %du;' % imm, 'u32 t = add_flags(%s, b, 0u, &cf, &vf);' % r, '%s = t;' % r, _flags_nz(rd)]
    else:
        insn.lines = ['u32 b = %du;' % imm, 'u32 t = add_flags(%s, ~b, 1u, &cf, &vf);' % r, '%s = t;' % r, _flags_nz(rd)]
    return insn


def _alu(insn, hw):
    op = (hw >> 6) & 15
    rs, rd = (hw >> 3) & 7, hw & 7
    d, s = REGS[rd], REGS[rs]
    names = ['and', 'eor', 'lsl', 'lsr', 'asr', 'adc', 'sbc', 'ror', 'tst', 'neg', 'cmp', 'cmn', 'orr', 'mul', 'bic',
             'mvn']
    insn.mnem = names[op]
    nz = _flags_nz(rd)
    if op == 0:
        L = ['u32 t = %s & %s;' % (d, s), '%s = t;' % d, nz]
    elif op == 1:
        L = ['u32 t = %s ^ %s;' % (d, s), '%s = t;' % d, nz]
    elif op in (2, 3, 4, 7):
        fn = {2: 'shl_c', 3: 'shr_c', 4: 'sar_c', 7: 'ror_c'}[op]
        L = ['u32 t = %s(%s, %s & 0xffu, &cf);' % (fn, d, s), '%s = t;' % d, nz]
    elif op == 5:
        L = ['u32 t = add_flags(%s, %s, cf, &cf, &vf);' % (d, s), '%s = t;' % d, nz]
    elif op == 6:
        L = ['u32 t = add_flags(%s, ~%s, cf, &cf, &vf);' % (d, s), '%s = t;' % d, nz]
    elif op == 8:
        L = ['u32 t = %s & %s;' % (d, s), nz]
    elif op == 9:
        L = ['u32 t = add_flags(0u, ~%s, 1u, &cf, &vf);' % s, '%s = t;' % d, nz]
    elif op == 10:
        L = ['u32 t = add_flags(%s, ~%s, 1u, &cf, &vf);' % (d, s), nz]
    elif op == 11:
        L = ['u32 t = add_flags(%s, %s, 0u, &cf, &vf);' % (d, s), nz]
    elif op == 12:
        L = ['u32 t = %s | %s;' % (d, s), '%s = t;' % d, nz]
    elif op == 13:
        L = ['u32 t = %s * %s;' % (d, s), '%s = t;' % d, nz]
    elif op == 14:
        L = ['u32 t = %s & ~%s;' % (d, s), '%s = t;' % d, nz]
    else:
        L = ['u32 t = ~%s;' % s, '%s = t;' % d, nz]
    insn.lines = L
    return insn


def _hireg(insn, hw, ctx):
    op = (hw >> 8) & 3
    h1, h2 = (hw >> 7) & 1, (hw >> 6) & 1
    rs = ((hw >> 3) & 7) | (h2 << 3)
    rd = (hw & 7) | (h1 << 3)
    addr = insn.addr
    if op == 3:                                            # bx / blx
        insn.mnem = 'blx' if h1 else 'bx'
        if rs == 15:
            return _bad(insn, 'bx pc')
        if h1:
            insn.lines = ['u32 t = %s;' % REGS[rs], 'lr = %s;' % lit((addr + 2) | 1),
                          'RT_SAVE(); rt_dispatch(c, t); RT_LOAD();']
            insn.kind = 'call'
            return insn
        if rs == 14:
            insn.lines = ['RT_SAVE(); return;']
            insn.kind = 'ret'
            return insn.stop()
        insn.lines = ['u32 t = %s;' % REGS[rs], 'RT_SAVE(); rt_dispatch(c, t); return;']
        insn.kind = 'tail'
        return insn.stop()
    src = lit(addr + 4) if rs == 15 else REGS[rs]
    insn.mnem = ['add', 'cmp', 'mov'][op]
    if op == 1:
        insn.lines = ['u32 b = %s;' % src, 'u32 t = add_flags(%s, ~b, 1u, &cf, &vf);' % (lit(addr + 4) if rd == 15 else REGS[rd]),
                      _flags_nz(rd)]
        return insn
    if rd == 15:                                           # mov pc, rs / add pc, rs : saut calculé
        if op == 2:
            insn.lines = ['u32 t = %s;' % src]
        else:
            return _table_add(insn, ctx, rs)
        insn.lines += ['RT_SAVE(); rt_dispatch(c, t | 1u); return;']
        insn.kind = 'tail'
        return insn.stop()
    if op == 0:
        insn.lines = ['%s = %s + %s;' % (REGS[rd], REGS[rd], src)]
    else:
        insn.lines = ['%s = %s;' % (REGS[rd], src)]
    return insn


def _table_add(insn, ctx, rs):
    """add pc, rs : le décalage est ajouté à pc+4 ; il tombe sur une table d'instructions « b » de deux octets."""
    base = insn.addr + 4
    entries = []
    a = base
    while len(entries) < 1024:
        hw = ctx.image.half(a) if ctx.image is not None else None
        if hw is None or (hw >> 11) != 28:
            break
        entries.append(a)
        a += 2
    if not entries:
        return _bad(insn, 'add pc sans table de branchements')
    cases = ['case %s: goto L_%08x;' % (lit(e), e) for e in entries]
    insn.lines = ['switch (%s + %s) {' % (lit(base), REGS[rs])] + cases + \
                 ['default: RT_SAVE(); rt_unimplemented(c, %s);' % lit(insn.addr), '}']
    insn.succ = entries
    insn.kind = 'switch'
    return insn.stop()


def _ldst_reg(insn, hw):
    op = (hw >> 9) & 7
    ro, rb, rd = (hw >> 6) & 7, (hw >> 3) & 7, hw & 7
    ea = '%s + %s' % (REGS[rb], REGS[ro])
    names = ['str', 'strh', 'strb', 'ldrsb', 'ldr', 'ldrh', 'ldrb', 'ldrsh']
    insn.mnem = names[op]
    d = REGS[rd]
    insn.lines = {
        0: ['wr32(%s, %s);' % (ea, d)],
        1: ['wr16(%s, %s);' % (ea, d)],
        2: ['wr8(%s, %s);' % (ea, d)],
        3: ['%s = (u32)(s32)(int8_t)rd8(%s);' % (d, ea)],
        4: ['%s = rd32(%s);' % (d, ea)],
        5: ['%s = rd16(%s);' % (d, ea)],
        6: ['%s = rd8(%s);' % (d, ea)],
        7: ['%s = (u32)(s32)(int16_t)rd16(%s);' % (d, ea)],
    }[op]
    return insn


def _ldst_imm(insn, hw):
    byte, load = (hw >> 12) & 1, (hw >> 11) & 1
    imm = (hw >> 6) & 31
    rb, rd = (hw >> 3) & 7, hw & 7
    off = imm if byte else imm * 4
    ea = '%s + %du' % (REGS[rb], off)
    d = REGS[rd]
    insn.mnem = ('ldr' if load else 'str') + ('b' if byte else '')
    if load:
        insn.lines = ['%s = rd%s(%s);' % (d, '8' if byte else '32', ea)]
    else:
        insn.lines = ['wr%s(%s, %s);' % ('8' if byte else '32', ea, d)]
    return insn


def _ldmstm(insn, hw):
    load = (hw >> 11) & 1
    rb = (hw >> 8) & 7
    regs = [i for i in range(8) if (hw >> i) & 1]
    if not regs:
        return _bad(insn, 'ldm/stm liste vide')
    n = len(regs)
    insn.mnem = 'ldmia' if load else 'stmia'
    L = ['u32 base = %s;' % REGS[rb]]
    if load:
        for k, r in enumerate(regs):
            L.append('u32 v%d = rd32(base + %d);' % (r, 4 * k))
        if rb not in regs:
            L.append('%s = base + %du;' % (REGS[rb], 4 * n))
        for r in regs:
            L.append('%s = v%d;' % (REGS[r], r))
    else:
        for k, r in enumerate(regs):
            val = REGS[r] if r != rb else 'base'
            if r == rb and k > 0:
                val = 'base + %du' % (4 * n)
            L.append('wr32(base + %d, %s);' % (4 * k, val))
        L.append('%s = base + %du;' % (REGS[rb], 4 * n))
    insn.lines = L
    return insn


def _misc(insn, hw, ctx):
    addr = insn.addr
    if (hw & 0xFF00) == 0xB000:                            # add / sub sp, #imm7*4
        off = (hw & 0x7F) * 4
        insn.mnem = 'sub' if hw & 0x80 else 'add'
        insn.lines = ['sp = sp %s %du;' % ('-' if hw & 0x80 else '+', off)]
        return insn
    if (hw & 0xF600) == 0xB400:                            # push / pop
        load = (hw >> 11) & 1
        extra = (hw >> 8) & 1
        regs = [i for i in range(8) if (hw >> i) & 1]
        n = len(regs) + extra
        if load:
            insn.mnem = 'pop'
            L = ['u32 base = sp;']
            for k, r in enumerate(regs):
                L.append('u32 v%d = rd32(base + %d);' % (r, 4 * k))
            if extra:
                L.append('u32 tp = rd32(base + %d);' % (4 * len(regs)))
            L.append('sp = base + %du;' % (4 * n))
            for r in regs:
                L.append('%s = v%d;' % (REGS[r], r))
            insn.lines = L
            if extra:
                insn.lines = L + ['RT_SAVE(); return;']
                insn.kind = 'ret'
                return insn.stop()
            return insn
        insn.mnem = 'push'
        L = ['u32 base = sp - %du;' % (4 * n)]
        for k, r in enumerate(regs):
            L.append('wr32(base + %d, %s);' % (4 * k, REGS[r]))
        if extra:
            L.append('wr32(base + %d, lr);' % (4 * len(regs)))
        L.append('sp = base;')
        insn.lines = L
        return insn
    if (hw & 0xFF00) == 0xB200:                            # sxth sxtb uxth uxtb
        op = (hw >> 6) & 3
        rm, rd = (hw >> 3) & 7, hw & 7
        insn.mnem = ['sxth', 'sxtb', 'uxth', 'uxtb'][op]
        e = ['(u32)(s32)(int16_t)%s', '(u32)(s32)(int8_t)%s', '(%s & 0xffffu)', '(%s & 0xffu)'][op] % REGS[rm]
        insn.lines = ['%s = %s;' % (REGS[rd], e)]
        return insn
    if (hw & 0xFF00) == 0xBA00 and ((hw >> 6) & 3) != 2:    # rev rev16 revsh
        op = (hw >> 6) & 3
        rm, rd = (hw >> 3) & 7, hw & 7
        insn.mnem = ['rev', 'rev16', '', 'revsh'][op]
        x = REGS[rm]
        e = ['__builtin_bswap32(%s)' % x, '(((%s & 0x00ff00ffu) << 8) | ((%s >> 8) & 0x00ff00ffu))' % (x, x), '',
             '(u32)(s32)(int16_t)__builtin_bswap16((u16)%s)' % x][op]
        insn.lines = ['%s = %s;' % (REGS[rd], e)]
        return insn
    if (hw & 0xFF00) == 0xBF00 and (hw & 0xF) == 0:        # nop, yield, wfe, wfi, sev
        insn.mnem = 'hint'
        insn.lines = ['/* hint */']
        return insn
    if (hw & 0xFFE8) == 0xB660:                            # cps
        insn.mnem = 'cps'
        insn.lines = ['/* cps */']
        return insn
    return _bad(insn, 'thumb divers non couvert')
