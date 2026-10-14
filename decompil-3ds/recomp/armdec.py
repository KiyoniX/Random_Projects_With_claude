"""Le décodeur ARM (mode ARM, ARMv6K) : un mot de 32 bits -> des lignes de C.

Il ne dépend pas de capstone : le décodage est fait ici, d'après le manuel de l'ARM (« A5 ARM Instruction Set
Encoding »), et c'est la validation différentielle contre unicorn (recomp/harness.py) qui dit s'il a raison.

Chaque mot décodé donne un `Insn` :
  - `lines` : les instructions C de son effet, sans la condition (l'assembleur de fonction l'ajoute) ;
  - `succ`  : les adresses de la même fonction où le contrôle peut aller (hors passage au mot suivant) ;
  - `fall`  : vrai si le contrôle peut continuer au mot suivant ;
  - `unimpl`: si non vide, la raison pour laquelle l'instruction n'est pas traduite (le C appelle alors
              rt_unimplemented : jamais de silence).
Les registres sont des variables locales du C (r0..r12, sp, lr), les drapeaux nf zf cf vf qf et ge aussi (voir rt.h).
"""

REGS = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'sp', 'lr']
COND = ['zf', '!zf', 'cf', '!cf', 'nf', '!nf', 'vf', '!vf', '(cf && !zf)', '(!cf || zf)', '(nf == vf)', '(nf != vf)',
        '(!zf && nf == vf)', '(zf || nf != vf)', None, None]
LOGICAL = {0, 1, 8, 9, 12, 13, 14, 15}
M32 = 0xFFFFFFFF


def ror(value, amount):
    amount &= 31
    return ((value >> amount) | (value << (32 - amount))) & M32 if amount else value & M32


def sext(value, bits):
    value &= (1 << bits) - 1
    return value - (1 << bits) if value >> (bits - 1) else value


def lit(value):
    return '0x%08xu' % (value & M32)


class Insn:
    __slots__ = ('addr', 'word', 'cond', 'lines', 'succ', 'fall', 'unimpl', 'kind', 'mnem', 'size', 'thumb')

    def __init__(self, addr, word):
        self.addr = addr
        self.word = word
        self.cond = word >> 28
        self.lines = []
        self.succ = []
        self.fall = True
        self.unimpl = ''
        self.kind = 'seq'        # seq, branch, call, ret, tail, switch, svc
        self.mnem = ''
        self.size = 4
        self.thumb = False

    def stop(self):
        """Le contrôle ne continue pas au mot suivant (l'assembleur remet le passage si l'instruction est conditionnelle)."""
        self.fall = False
        return self


class Ctx:
    """Ce que le décodeur a besoin de savoir de la fonction et du programme."""

    def __init__(self, start, end, known=(), image=None, read_word=None, limit=None):
        self.start = start
        self.end = end
        self.limit = limit or end       # début de la fonction suivante : jusqu'où la fonction peut s'étendre
        self.known = known              # ensemble des adresses de fonctions recompilées
        self.image = image              # objet avec .const32(addr) -> valeur ou None (mémoire en lecture seule)
        self.read_word = read_word      # adresse -> mot du code, ou None hors du code
        self.prev_word = None           # le mot précédent (motif « mov lr, pc »)
        self.callees = set()            # adresses des fonctions appelées ou sautées de façon statique

    def inside(self, addr):
        return self.start <= addr < self.end

    def claim(self, addr):
        """Comme `inside`, mais une cible entre la fin déclarée et la fonction suivante agrandit la fonction :
        Ghidra coupe parfois une fonction avant les blocs d'un `switch` qu'il n'a pas résolu."""
        if self.start <= addr < self.end:
            return True
        if self.end <= addr < self.limit and addr not in self.known and (addr | 1) not in self.known:
            self.end = self.limit
            return True
        return False

    def call_lines(self, target):
        self.callees.add(target)
        if target in self.known:
            return ['RT_SAVE(); f_%08x(c); RT_LOAD();' % target]
        return ['RT_SAVE(); rt_dispatch(c, %s); RT_LOAD();' % lit(target)]


def reg_read(n, addr, ahead=8):
    return lit(addr + ahead) if n == 15 else REGS[n]


# ---------------------------------------------------------------------------------------------------------------------
# Le registre-opérande décalé (« shifter operand »)
# ---------------------------------------------------------------------------------------------------------------------

def shifted_reg(word, addr, need_carry):
    """Le second opérande en forme registre, avec décalage. Rend (lignes, expression, expression de la retenue ou None)."""
    rm = word & 15
    stype = (word >> 5) & 3
    if word & 0x10:                                     # décalage par registre
        rs = (word >> 8) & 15
        x = reg_read(rm, addr, 12)
        pre = ['u32 amt = %s & 0xffu;' % reg_read(rs, addr, 12)]
        names = ['shl', 'shr', 'sar', 'ror']
        if need_carry:
            pre.append('u32 sc = cf;')
            return pre, '%s_c(%s, amt, &sc)' % (names[stype], x), 'sc'
        return pre, '%s_r(%s, amt)' % (names[stype], x), None
    amt = (word >> 7) & 31
    x = reg_read(rm, addr, 8)
    if stype == 0:                                      # LSL
        if amt == 0:
            return [], x, ('cf' if need_carry else None)
        return [], '(%s << %d)' % (x, amt), ('((%s >> %d) & 1u)' % (x, 32 - amt) if need_carry else None)
    if stype == 1:                                      # LSR (0 = 32)
        if amt == 0:
            return [], '0u', ('(%s >> 31)' % x if need_carry else None)
        return [], '(%s >> %d)' % (x, amt), ('((%s >> %d) & 1u)' % (x, amt - 1) if need_carry else None)
    if stype == 2:                                      # ASR (0 = 32)
        if amt == 0:
            return [], '((u32)((s32)%s >> 31))' % x, ('(%s >> 31)' % x if need_carry else None)
        return [], '((u32)((s32)%s >> %d))' % (x, amt), ('((%s >> %d) & 1u)' % (x, amt - 1) if need_carry else None)
    if amt == 0:                                        # RRX
        return [], '((cf << 31) | (%s >> 1))' % x, ('(%s & 1u)' % x if need_carry else None)
    return [], 'ror32(%s, %d)' % (x, amt), ('((%s >> %d) & 1u)' % (x, amt - 1) if need_carry else None)


def offset_reg(word, addr):
    """Le décalage d'un LDR/STR en forme registre : pas de décalage par registre, pas de retenue sortante."""
    pre, expr, _ = shifted_reg(word & ~0x10, addr, False)
    return expr


# ---------------------------------------------------------------------------------------------------------------------
# Le décodeur
# ---------------------------------------------------------------------------------------------------------------------

def decode(word, addr, ctx):
    insn = Insn(addr, word)
    if insn.cond == 15:
        _unconditional(insn, ctx)
    else:
        _decode(insn, ctx)
    return insn


def _bad(insn, why):
    insn.unimpl = why
    insn.lines = []
    insn.succ = []
    insn.fall = False
    insn.kind = 'seq'
    return insn


def _decode(insn, ctx):
    w = insn.word
    top = (w >> 25) & 7
    if top == 0 or top == 1:
        return _group0(insn, ctx)
    if top == 2:
        return _single(insn, ctx)
    if top == 3:
        if w & 0x10:
            return _media(insn, ctx)
        return _single(insn, ctx)
    if top == 4:
        return _block(insn, ctx)
    if top == 5:
        return _branch(insn, ctx)
    if top == 6:
        return _coproc_mem(insn, ctx)
    if (w >> 24) & 15 == 15:
        num = w & 0xFFFFFF
        insn.mnem = 'svc'
        insn.kind = 'svc'
        insn.lines = ['RT_SAVE(); rt_svc(c, 0x%x, %s); RT_LOAD();' % (num, lit(insn.addr + 4))]
        return insn
    return _coproc_reg(insn, ctx)


def _group0(insn, ctx):
    w = insn.word
    if not (w & 0x02000000):
        if (w & 0x0FFFFFF0) == 0x012FFF10:
            return _bx(insn, ctx, w & 15, link=False)
        if (w & 0x0FFFFFF0) == 0x012FFF30:
            return _bx(insn, ctx, w & 15, link=True)
        if (w & 0x0FF000F0) == 0x01200070:
            return _bad(insn, 'bkpt')
        if (w & 0x90) == 0x90:
            if ((w >> 5) & 3) == 0:
                return _mul_group(insn, ctx)
            return _halfword(insn, ctx)
        if (w & 0x01900000) == 0x01000000:              # opcodes de test sans S : instructions diverses
            return _misc(insn, ctx)
        return _data_processing(insn, ctx)
    if (w & 0x0FFF0000) == 0x03200000 and (w & 0xF000) == 0xF000:
        insn.mnem = 'hint'
        insn.lines = ['/* hint */']
        return insn
    if (w & 0x0FB0F000) == 0x0320F000:
        return _msr_imm(insn, ctx)
    if (w & 0x01900000) == 0x01000000:
        return _bad(insn, 'opcode de test sans S')
    return _data_processing(insn, ctx)


def _misc(insn, ctx):
    w = insn.word
    if (w & 0x0FBF0FFF) == 0x010F0000:                  # MRS rd, cpsr
        rd = (w >> 12) & 15
        insn.mnem = 'mrs'
        if w & 0x00400000 or rd == 15:
            return _bad(insn, 'mrs spsr')
        insn.lines = ['%s = (nf << 31) | (zf << 30) | (cf << 29) | (vf << 28) | (qf << 27) | (ge << 16) | 0x10u;'
                      % REGS[rd]]
        return insn
    if (w & 0x0FB0FFF0) == 0x0120F000:                  # MSR cpsr_fsxc, rm
        return _msr(insn, ctx, REGS[w & 15] if (w & 15) != 15 else lit(insn.addr + 8))
    if (w & 0x0FFF0FF0) == 0x016F0F10:                  # CLZ
        rd, rm = (w >> 12) & 15, w & 15
        insn.mnem = 'clz'
        if rd == 15 or rm == 15:
            return _bad(insn, 'clz pc')
        insn.lines = ['%s = clz32(%s);' % (REGS[rd], REGS[rm])]
        return insn
    if (w & 0x0F900FF0) == 0x01000050:                  # QADD QSUB QDADD QDSUB
        return _qarith(insn, ctx)
    if (w & 0x0F900090) == 0x01000080:                  # SMLAxy SMLAWy SMLALxy SMULxy SMULWy
        return _smul16(insn, ctx)
    return _bad(insn, 'instruction diverse non couverte')


def _msr_fields(insn, value_expr, mask):
    lines = []
    if mask & 8:
        lines += ['{ u32 m = %s; nf = m >> 31; zf = (m >> 30) & 1u; cf = (m >> 29) & 1u; vf = (m >> 28) & 1u; '
                  'qf = (m >> 27) & 1u; }' % value_expr]
    if mask & 4:
        lines += ['ge = (%s >> 16) & 15u;' % value_expr]
    if mask & 3:
        lines += ['/* msr : modes et masques ignorés */']
    return lines


def _msr(insn, ctx, value_expr):
    insn.mnem = 'msr'
    if insn.word & 0x00400000:
        return _bad(insn, 'msr spsr')
    insn.lines = _msr_fields(insn, value_expr, (insn.word >> 16) & 15)
    return insn


def _msr_imm(insn, ctx):
    w = insn.word
    imm = ror(w & 0xFF, 2 * ((w >> 8) & 15))
    return _msr(insn, ctx, lit(imm))


def _qarith(insn, ctx):
    w = insn.word
    rd, rn, rm = (w >> 12) & 15, (w >> 16) & 15, w & 15
    op = (w >> 21) & 3
    insn.mnem = ['qadd', 'qsub', 'qdadd', 'qdsub'][op]
    if 15 in (rd, rn, rm):
        return _bad(insn, 'q pc')
    a, b = REGS[rm], REGS[rn]                          # QADD Rd, Rm, Rn : Rm + Rn
    lines = ['s64 b = (s32)%s;' % b]
    if op >= 2:
        lines += ['b = ssat32(2 * b, 32, &qf);']
    if op in (0, 2):
        lines += ['%s = (u32)ssat32((s64)(s32)%s + b, 32, &qf);' % (REGS[rd], a)]
    else:
        lines += ['%s = (u32)ssat32((s64)(s32)%s - b, 32, &qf);' % (REGS[rd], a)]
    insn.lines = lines
    return insn


def _smul16(insn, ctx):
    w = insn.word
    rd, ra, rs, rm = (w >> 16) & 15, (w >> 12) & 15, (w >> 8) & 15, w & 15
    x, y = (w >> 5) & 1, (w >> 6) & 1
    op = (w >> 21) & 3
    if 15 in (rd, ra, rs, rm):
        return _bad(insn, 'multiplication 16 bits avec pc')
    names = {0: 'smla', 1: 'smlaw' if not x else 'smulw', 2: 'smlal', 3: 'smul'}
    insn.mnem = names[op]
    a = 'sx16(%s >> 16)' % REGS[rm] if x else 'sx16(%s)' % REGS[rm]
    b = 'sx16(%s >> 16)' % REGS[rs] if y else 'sx16(%s)' % REGS[rs]
    L = []
    if op == 0:
        L = ['s64 s = (s64)(%s * %s) + (s64)(s32)%s;' % (a, b, REGS[ra]),
             'if (s != (s64)(s32)s) qf = 1;', '%s = (u32)s;' % REGS[rd]]
    elif op == 1:
        L = ['s64 p = ((s64)(s32)%s * %s) >> 16;' % (REGS[rm], b)]
        if x:
            L += ['%s = (u32)p;' % REGS[rd]]
        else:
            L += ['s64 s = p + (s64)(s32)%s;' % REGS[ra], 'if (s != (s64)(s32)s) qf = 1;', '%s = (u32)s;' % REGS[rd]]
    elif op == 2:
        lo, hi = REGS[ra], REGS[rd]
        L = ['u64 s = ((u64)%s << 32 | %s) + (u64)(s64)(%s * %s);' % (hi, lo, a, b),
             '%s = (u32)s; %s = (u32)(s >> 32);' % (lo, hi)]
    else:
        L = ['%s = (u32)(%s * %s);' % (REGS[rd], a, b)]
    insn.lines = L
    return insn


# --- multiplications et accès exclusifs -------------------------------------------------------------------------------

def _mul_group(insn, ctx):
    w = insn.word
    S = (w >> 20) & 1
    if (w & 0x0FC000F0) == 0x00000090:                  # MUL, MLA
        acc = (w >> 21) & 1
        rd, rn, rs, rm = (w >> 16) & 15, (w >> 12) & 15, (w >> 8) & 15, w & 15
        if 15 in (rd, rs, rm) or (acc and rn == 15):
            return _bad(insn, 'mul pc')
        insn.mnem = 'mla' if acc else 'mul'
        e = '%s * %s' % (REGS[rm], REGS[rs])
        if acc:
            e += ' + %s' % REGS[rn]
        insn.lines = ['u32 t = %s;' % e, '%s = t;' % REGS[rd]] + (['nf = t >> 31; zf = (t == 0);'] if S else [])
        return insn
    if (w & 0x0F8000F0) == 0x00800090:                  # UMULL UMLAL SMULL SMLAL
        uns = not (w >> 22) & 1
        acc = (w >> 21) & 1
        hi, lo, rs, rm = (w >> 16) & 15, (w >> 12) & 15, (w >> 8) & 15, w & 15
        if 15 in (hi, lo, rs, rm) or hi == lo:
            return _bad(insn, 'mull pc')
        insn.mnem = ('u' if uns else 's') + ('mlal' if acc else 'mull')
        if uns:
            e = '(u64)%s * %s' % (REGS[rm], REGS[rs])
        else:
            e = '(u64)((s64)(s32)%s * (s64)(s32)%s)' % (REGS[rm], REGS[rs])
        L = ['u64 p = %s;' % e]
        if acc:
            L += ['p += ((u64)%s << 32) | %s;' % (REGS[hi], REGS[lo])]
        L += ['%s = (u32)p; %s = (u32)(p >> 32);' % (REGS[lo], REGS[hi])]
        if S:
            L += ['nf = (u32)(p >> 63); zf = (p == 0);']
        insn.lines = L
        return insn
    if (w & 0x0FF000F0) == 0x00400090:                  # UMAAL
        hi, lo, rs, rm = (w >> 16) & 15, (w >> 12) & 15, (w >> 8) & 15, w & 15
        if 15 in (hi, lo, rs, rm) or hi == lo:
            return _bad(insn, 'umaal pc')
        insn.mnem = 'umaal'
        insn.lines = ['u64 p = (u64)%s * %s + %s + %s;' % (REGS[rm], REGS[rs], REGS[lo], REGS[hi]),
                      '%s = (u32)p; %s = (u32)(p >> 32);' % (REGS[lo], REGS[hi])]
        return insn
    if (w & 0x0FB00FF0) == 0x01000090:                  # SWP, SWPB
        rn, rd, rm = (w >> 16) & 15, (w >> 12) & 15, w & 15
        if 15 in (rn, rd, rm):
            return _bad(insn, 'swp pc')
        byte = (w >> 22) & 1
        insn.mnem = 'swpb' if byte else 'swp'
        rd_, wr_ = ('rd8', 'wr8') if byte else ('rd32', 'wr32')
        insn.lines = ['u32 a = %s;' % REGS[rn], 'u32 t = %s(a);' % rd_, '%s(a, %s);' % (wr_, REGS[rm]),
                      '%s = t;' % REGS[rd]]
        return insn
    # LDREX / STREX et leurs formes octet, demi-mot, double mot
    rn, rd = (w >> 16) & 15, (w >> 12) & 15
    kinds = {0x01900F9F: ('ldrex', 32), 0x01D00F9F: ('ldrexb', 8), 0x01F00F9F: ('ldrexh', 16),
             0x01B00F9F: ('ldrexd', 64)}
    key = w & 0x0FF00FFF
    if key in kinds and rn != 15 and rd != 15:
        name, size = kinds[key]
        insn.mnem = name
        L = ['u32 a = %s;' % REGS[rn], 'if (a & %d) rt_misaligned(a);' % ({8: 0, 16: 1, 32: 3, 64: 7}[size]), 'c->excl_addr = a;']
        if size == 64:
            if rd & 1 or rd == 14:
                return _bad(insn, 'ldrexd registres')
            L += ['%s = rd32(a); %s = rd32(a + 4);' % (REGS[rd], REGS[rd + 1])]
        else:
            L += ['%s = rd%d(a);' % (REGS[rd], size)]
        insn.lines = L
        return insn
    skinds = {0x01800F90: ('strex', 32), 0x01C00F90: ('strexb', 8), 0x01E00F90: ('strexh', 16),
              0x01A00F90: ('strexd', 64)}
    key = w & 0x0FF00FF0
    rm = w & 15
    if key in skinds and rn != 15 and rd != 15 and rm != 15:
        name, size = skinds[key]
        insn.mnem = name
        L = ['u32 a = %s;' % REGS[rn], 'if (a & %d) rt_misaligned(a);' % ({8: 0, 16: 1, 32: 3, 64: 7}[size]), 'if (c->excl_addr == a) {']
        if size == 64:
            if rm & 1 or rm == 14:
                return _bad(insn, 'strexd registres')
            L += ['u32 v0 = %s, v1 = %s;' % (REGS[rm], REGS[rm + 1]), 'wr32(a, v0); wr32(a + 4, v1);']
        else:
            L += ['wr%d(a, %s);' % (size, REGS[rm])]
        L += ['%s = 0;' % REGS[rd], '} else {', '%s = 1;' % REGS[rd], '}', 'c->excl_addr = 0xFFFFFFFFu;']
        insn.lines = L
        return insn
    return _bad(insn, 'multiplication ou accès exclusif non couvert')


# --- données ---------------------------------------------------------------------------------------------------------

def _data_processing(insn, ctx):
    w = insn.word
    addr = insn.addr
    opc = (w >> 21) & 15
    S = (w >> 20) & 1
    rn, rd = (w >> 16) & 15, (w >> 12) & 15
    names = ['and', 'eor', 'sub', 'rsb', 'add', 'adc', 'sbc', 'rsc', 'tst', 'teq', 'cmp', 'cmn', 'orr', 'mov', 'bic',
             'mvn']
    insn.mnem = names[opc]
    test = opc in (8, 9, 10, 11)
    logical = opc in LOGICAL
    carry_needed = bool(S and logical)
    if test and not S:
        return _bad(insn, 'test sans S')
    reg_shift = not (w & 0x02000000) and bool(w & 0x10)
    if w & 0x02000000:
        imm = ror(w & 0xFF, 2 * ((w >> 8) & 15))
        pre, b, bc = [], lit(imm), None
        if carry_needed:
            rot = (w >> 8) & 15
            bc = '%du' % (imm >> 31) if rot else 'cf'
    else:
        pre, b, bc = shifted_reg(w, addr, carry_needed)
    a = reg_read(rn, addr, 12 if reg_shift else 8)
    L = list(pre)
    L.append('u32 b = %s;' % b)
    if bc is not None:
        L.append('u32 bc = %s;' % bc)
    if opc in (13, 15):
        use_a = False
    else:
        use_a = True
    arith = opc in (2, 3, 4, 5, 6, 7, 10, 11)
    if S and rd == 15 and not test:
        return _bad(insn, 'écriture de pc avec S (retour d\'exception)')
    if arith:
        if S:
            args = {2: ('%s' % a, '~b', '1u'), 3: ('b', '~%s' % a, '1u'), 4: ('%s' % a, 'b', '0u'),
                    5: ('%s' % a, 'b', 'cf'), 6: ('%s' % a, '~b', 'cf'), 7: ('b', '~%s' % a, 'cf'),
                    10: ('%s' % a, '~b', '1u'), 11: ('%s' % a, 'b', '0u')}[opc]
            L.append('u32 t = add_flags(%s, %s, %s, &cf, &vf);' % args)
            L.append('nf = t >> 31; zf = (t == 0);')
        else:
            e = {2: '%s - b' % a, 3: 'b - %s' % a, 4: '%s + b' % a, 5: '%s + b + cf' % a,
                 6: '%s + ~b + cf' % a, 7: 'b + ~%s + cf' % a}[opc]
            L.append('u32 t = %s;' % e)
    else:
        e = {0: '%s & b' % a, 1: '%s ^ b' % a, 8: '%s & b' % a, 9: '%s ^ b' % a, 12: '%s | b' % a,
             13: 'b', 14: '%s & ~b' % a, 15: '~b'}[opc]
        L.append('u32 t = %s;' % e)
        if S:
            L.append('nf = t >> 31; zf = (t == 0);')
            if bc is not None:
                L.append('cf = bc;')
    if test:
        insn.lines = L
        return insn
    if rd != 15:
        L.append('%s = t;' % REGS[rd])
        insn.lines = L
        return insn
    # écriture de pc
    insn.lines = L
    if opc == 13 and not (w & 0x02000000) and (w & 0xFF0) == 0 and (w & 15) == 14:
        insn.lines = ['RT_SAVE(); return;']
        insn.kind = 'ret'
        return insn.stop()
    if opc == 4 and rn == 15 and not (w & 0x02000000) and not (w & 0x10) and ((w >> 5) & 3) == 0 \
            and ((w >> 7) & 31) == 2:
        return _table_add(insn, ctx, w & 15)
    return _indirect_jump(insn, ctx, 't')


def _indirect_jump(insn, ctx, expr):
    """Un saut vers une adresse calculée : appel indirect par l'aiguillage. Après « mov lr, pc », c'est un appel."""
    if ctx.prev_word == 0xE1A0E00F:
        insn.lines += ['RT_SAVE(); rt_dispatch(c, %s); RT_LOAD();' % expr]
        insn.kind = 'call'
        return insn
    insn.lines += ['RT_SAVE(); rt_dispatch(c, %s); return;' % expr]
    insn.kind = 'tail'
    return insn.stop()


def _table_add(insn, ctx, rm):
    """add pc, pc, rm, lsl #2 : suivi d'une table de « b »."""
    base = insn.addr + 8
    entries = []
    a = base
    while len(entries) < 4096:
        word = ctx.read_word(a)
        if word is None or (word >> 24) != 0xEA:
            break
        entries.append(a)
        a += 4
    if not entries:
        return _bad(insn, 'add pc sans table de branchements')
    cases = ['case %s: goto L_%08x;' % (lit(e), e) for e in entries]
    insn.lines += ['switch (%s + (%s << 2)) {' % (lit(base), REGS[rm])] + cases + \
                  ['default: RT_SAVE(); rt_unimplemented(c, %s);' % lit(insn.addr), '}']
    insn.succ = entries
    insn.kind = 'switch'
    return insn.stop()


# --- branchements ----------------------------------------------------------------------------------------------------

def _bx(insn, ctx, rm, link):
    insn.mnem = 'blx' if link else 'bx'
    if rm == 15:
        return _bad(insn, 'bx pc')
    if link:
        insn.lines = ['u32 t = %s;' % REGS[rm], 'lr = %s;' % lit(insn.addr + 4), 'RT_SAVE(); rt_dispatch(c, t); RT_LOAD();']
        insn.kind = 'call'
        return insn
    if rm == 14:
        insn.lines = ['RT_SAVE(); return;']
        insn.kind = 'ret'
        return insn.stop()
    insn.lines = ['u32 t = %s;' % REGS[rm]]
    return _indirect_jump(insn, ctx, 't')


def _branch(insn, ctx):
    w = insn.word
    target = (insn.addr + 8 + (sext(w, 24) << 2)) & M32
    link = (w >> 24) & 1
    insn.mnem = 'bl' if link else 'b'
    if link:
        insn.lines = ['lr = %s;' % lit(insn.addr + 4)] + ctx.call_lines(target)
        insn.kind = 'call'
        return insn
    if ctx.claim(target):
        insn.lines = ['%sgoto L_%08x;' % ('RT_BACKEDGE(); ' if target <= insn.addr else '', target)]
        insn.succ = [target]
        insn.kind = 'branch'
        return insn.stop()
    insn.kind = 'tail'
    ctx.callees.add(target)
    if target in ctx.known:
        insn.lines = ['RT_SAVE(); f_%08x(c); return;' % target]
    else:
        insn.lines = ['RT_SAVE(); rt_dispatch(c, %s); return;' % lit(target)]
    return insn.stop()


def _unconditional(insn, ctx):
    w = insn.word
    if (w & 0xFE000000) == 0xFA000000:                  # BLX imm (vers Thumb)
        target = (insn.addr + 8 + (sext(w, 24) << 2) + (((w >> 24) & 1) << 1)) & M32
        insn.mnem = 'blx'
        insn.lines = ['lr = %s;' % lit(insn.addr + 4)]
        ctx.callees.add(target & ~1)
        if (target | 1) in ctx.known:
            insn.lines.append('RT_SAVE(); f_%08x(c); RT_LOAD();' % (target & ~1))
        else:
            insn.lines.append('RT_SAVE(); rt_dispatch(c, %s); RT_LOAD();' % lit(target | 1))
        insn.kind = 'call'
        return insn
    if (w & 0xFD70F000) == 0xF550F000:                  # PLD
        insn.mnem = 'pld'
        insn.lines = ['/* pld */']
        return insn
    if w == 0xF57FF01F:
        insn.mnem = 'clrex'
        insn.lines = ['c->excl_addr = 0xFFFFFFFFu;']
        return insn
    return _bad(insn, 'instruction inconditionnelle non couverte')


# --- accès mémoire simples -------------------------------------------------------------------------------------------

def _single(insn, ctx):
    w = insn.word
    addr = insn.addr
    I, P, U, B, W, Lb = [(w >> s) & 1 for s in (25, 24, 23, 22, 21, 20)]
    rn, rd = (w >> 16) & 15, (w >> 12) & 15
    load = bool(Lb)
    insn.mnem = ('ldr' if load else 'str') + ('b' if B else '')
    if not P and W:
        insn.mnem += 't'
        return _bad(insn, 'accès non privilégié (ldrt/strt)')
    wb = (not P) or W
    if wb and rn == 15:
        return _bad(insn, 'écriture-retour sur pc')
    sign = '+' if U else '-'
    size = 8 if B else 32
    L = []
    if I:
        if w & 0x10:
            return _bad(insn, 'LDR registre avec décalage par registre')
        off = offset_reg(w, addr)
        L.append('u32 off = %s;' % off)
        off_expr = 'off'
        const_off = None
    else:
        const_off = w & 0xFFF
        off_expr = '%du' % const_off
    base = reg_read(rn, addr, 8)
    # adresse effective
    if P:
        L.append('u32 ea = %s %s %s;' % (base, sign, off_expr))
    else:
        L.append('u32 ea = %s;' % base)
    newbase = None
    if wb:
        newbase = 'ea' if P else '%s %s %s' % (base, sign, off_expr)
    if load:
        # une constante en mémoire en lecture seule : le pool de littéraux
        if rn == 15 and not I and P and not wb and ctx.image is not None:
            ea = (addr + 8 + (const_off if U else -const_off)) & M32
            val = ctx.image.const32(ea) if size == 32 else ctx.image.const8(ea)
            if val is not None and rd != 15:
                insn.lines = ['%s = %s;' % (REGS[rd], lit(val))]
                return insn
        L.append('u32 t = rd%d(ea);' % size)
        if newbase is not None:
            L.append('%s = %s;' % (REGS[rn], newbase))
        if rd != 15:
            L.append('%s = t;' % REGS[rd])
            insn.lines = L
            return insn
        insn.lines = L
        if B:
            return _bad(insn, 'ldrb pc')
        # ldr pc, ... : retour, table de sauts ou saut indirect
        if rn == 13 and not P and not I and U and const_off == 4:
            insn.lines = L + ['RT_SAVE(); return;']
            insn.kind = 'ret'
            return insn.stop()
        if rn == 15 and P and I and ((w >> 5) & 3) == 0 and ((w >> 7) & 31) == 2 and U and not wb:
            return _table_ldr(insn, ctx, w & 15)
        return _indirect_jump(insn, ctx, 't')
    # stockage
    if rd == 15:
        L.append('u32 t = %s;' % lit(addr + 8))
    else:
        L.append('u32 t = %s;' % REGS[rd])
    L.append('wr%d(ea, t);' % size)
    if newbase is not None:
        L.append('%s = %s;' % (REGS[rn], newbase))
    insn.lines = L
    return insn


def _table_ldr(insn, ctx, rm):
    """ldr pc, [pc, rm, lsl #2] : suivi d'une table d'adresses. Une adresse hors de la fonction n'est admise que si
    c'est le début d'une fonction connue (Ghidra coupe parfois une fonction au milieu d'un `switch`) : appel terminal."""
    base = insn.addr + 8
    entries = []
    a = base
    while len(entries) < 4096:
        word = ctx.read_word(a)
        if word is None or word & 3 or not (ctx.claim(word) or word in ctx.known):
            break
        entries.append((a, word))
        a += 4
    if not entries:
        return _bad(insn, "ldr pc sans table d'adresses")
    cases = []
    for e, t in entries:
        if ctx.inside(t):
            cases.append('case %s: goto L_%08x;' % (lit(e), t))
        else:
            ctx.callees.add(t)
            cases.append('case %s: RT_SAVE(); f_%08x(c); return;' % (lit(e), t))
    insn.lines += ['switch (%s + (%s << 2)) {' % (lit(base), REGS[rm])] + cases +                   ['default: RT_SAVE(); rt_unimplemented(c, %s);' % lit(insn.addr), '}']
    insn.succ = sorted(set(t for _, t in entries if ctx.inside(t)))
    insn.kind = 'switch'
    return insn.stop()


def _halfword(insn, ctx):
    w = insn.word
    addr = insn.addr
    P, U, Ib, W, Lb = [(w >> s) & 1 for s in (24, 23, 22, 21, 20)]
    rn, rd = (w >> 16) & 15, (w >> 12) & 15
    s, h = (w >> 6) & 1, (w >> 5) & 1
    load = bool(Lb)
    if not load and s:                                  # LDRD / STRD
        name, size = ('ldrd' if not h else 'strd'), 64
        # SH=10 : LDRD, SH=11 : STRD (L=0)
        name = 'ldrd' if not h else 'strd'
    elif s:
        name, size = ('ldrsh' if h else 'ldrsb'), (16 if h else 8)
    else:
        name, size = ('ldrh' if load else 'strh'), 16
    insn.mnem = name
    if not P and W:
        return _bad(insn, 'accès non privilégié')
    wb = (not P) or W
    if wb and rn == 15:
        return _bad(insn, 'écriture-retour sur pc')
    sign = '+' if U else '-'
    L = []
    if Ib:
        off_expr = '%du' % (((w >> 4) & 0xF0) | (w & 15))
    else:
        if (w & 15) == 15:
            return _bad(insn, 'décalage par pc')
        off_expr = REGS[w & 15]
    base = reg_read(rn, addr, 8)
    L.append('u32 ea = %s;' % (('%s %s %s' % (base, sign, off_expr)) if P else base))
    newbase = ('ea' if P else '%s %s %s' % (base, sign, off_expr)) if wb else None
    if size == 64:
        if rd & 1 or rd == 14:
            return _bad(insn, 'ldrd/strd registres')
        if load_double(name):
            L += ['u32 t0 = rd32(ea), t1 = rd32(ea + 4);']
            if newbase:
                L.append('%s = %s;' % (REGS[rn], newbase))
            L.append('%s = t0; %s = t1;' % (REGS[rd], REGS[rd + 1]))
        else:
            L += ['u32 t0 = %s, t1 = %s;' % (REGS[rd], REGS[rd + 1]), 'wr32(ea, t0); wr32(ea + 4, t1);']
            if newbase:
                L.append('%s = %s;' % (REGS[rn], newbase))
        insn.lines = L
        return insn
    if load:
        if rd == 15:
            return _bad(insn, 'ldrh pc')
        e = {'ldrh': 'rd16(ea)', 'ldrsh': '(u32)(s32)(int16_t)rd16(ea)', 'ldrsb': '(u32)(s32)(int8_t)rd8(ea)'}[name]
        if rn == 15 and Ib and P and not wb and ctx.image is not None and name == 'ldrh':
            ea = (addr + 8 + (int(off_expr[:-1]) if U else -int(off_expr[:-1]))) & M32
            c16 = ctx.image.const16(ea)
            if c16 is not None:
                insn.lines = ['%s = %s;' % (REGS[rd], lit(c16))]
                return insn
        L.append('u32 t = %s;' % e)
        if newbase:
            L.append('%s = %s;' % (REGS[rn], newbase))
        L.append('%s = t;' % REGS[rd])
    else:
        src = lit(addr + 8) if rd == 15 else REGS[rd]
        L.append('wr16(ea, %s);' % src)
        if newbase:
            L.append('%s = %s;' % (REGS[rn], newbase))
    insn.lines = L
    return insn


def load_double(name):
    return name == 'ldrd'


def _block(insn, ctx):
    w = insn.word
    addr = insn.addr
    P, U, S, W, Lb = [(w >> s) & 1 for s in (24, 23, 22, 21, 20)]
    rn = (w >> 16) & 15
    regs = [i for i in range(16) if (w >> i) & 1]
    n = len(regs)
    load = bool(Lb)
    mode = ('ib' if P else 'ia') if U else ('db' if P else 'da')
    insn.mnem = ('ldm' if load else 'stm') + mode
    if rn == 15 or n == 0:
        return _bad(insn, 'ldm/stm pc ou liste vide')
    if S:
        return _bad(insn, 'ldm/stm avec ^ (registres de l\'utilisateur)')
    base = REGS[rn]
    L = ['u32 base = %s;' % base]
    if U:
        start = 'base + 4u' if P else 'base'
        newb = 'base + %du' % (4 * n)
    else:
        start = ('base - %du' % (4 * n)) if P else ('base - %du' % (4 * n - 4))
        newb = 'base - %du' % (4 * n)
    L.append('u32 a = %s;' % start)
    if load:
        has_pc = 15 in regs
        for k, r in enumerate(regs):
            if r == 15:
                L.append('u32 tp = rd32(a + %d);' % (4 * k))
            else:
                L.append('u32 v%d = rd32(a + %d);' % (r, 4 * k))
        if W and rn not in regs:
            L.append('%s = %s;' % (base, newb))
        for r in regs:
            if r != 15:
                L.append('%s = v%d;' % (REGS[r], r))
        insn.lines = L
        if not has_pc:
            return insn
        if rn == 13 and W:
            insn.lines = L + ['RT_SAVE(); return;']
            insn.kind = 'ret'
            return insn.stop()
        return _indirect_jump(insn, ctx, 'tp')
    # stockage
    for k, r in enumerate(regs):
        if r == 15:
            val = lit(addr + 8)
        elif r == rn and W and k > 0:
            val = newb
        else:
            val = REGS[r] if r != rn else 'base'
        L.append('wr32(a + %d, %s);' % (4 * k, val))
    if W:
        L.append('%s = %s;' % (base, newb))
    insn.lines = L
    return insn


# --- instructions médias de l'ARMv6 ----------------------------------------------------------------------------------

def _media(insn, ctx):
    w = insn.word
    op1 = (w >> 20) & 0xFF                              # bits 27:20
    op2 = (w >> 5) & 7
    rd, rn, rm = (w >> 12) & 15, (w >> 16) & 15, w & 15
    top = op1 & 0xF8
    if 0x61 <= op1 <= 0x67 and op1 != 0x64:             # opérations en parallèle
        return _parallel(insn, ctx)
    if 0x68 <= op1 <= 0x6F:
        return _pack_sat_ext(insn, ctx)
    if op1 == 0x70 or op1 == 0x74:
        return _dual_mul(insn, ctx)
    if op1 == 0x75:
        return _mul_high(insn, ctx)
    if op1 == 0x78 and (w & 0xF0) == 0x10:
        ra = rd
        rdd, rs = rn, (w >> 8) & 15
        if 15 in (rdd, rm, rs):
            return _bad(insn, 'usad8 pc')
        insn.mnem = 'usad8' if ra == 15 else 'usada8'
        e = 'rt_usad8(%s, %s)' % (REGS[rm], REGS[rs])
        if ra != 15:
            e += ' + %s' % REGS[ra]
        insn.lines = ['%s = %s;' % (REGS[rdd], e)]
        return insn
    return _bad(insn, 'instruction média non couverte')


def _parallel(insn, ctx):
    w = insn.word
    op1 = (w >> 20) & 0xFF
    kinds = {1: 0, 2: 1, 3: 2, 5: 3, 6: 4, 7: 5}
    ops = {0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 7: 5}
    op2 = (w >> 5) & 7
    if (op1 & 7) not in kinds or op2 not in ops or (w & 0xF00) != 0xF00 or not (w & 0x10):
        return _bad(insn, 'parallèle non couvert')
    rd, rn, rm = (w >> 12) & 15, (w >> 16) & 15, w & 15
    if 15 in (rd, rn, rm):
        return _bad(insn, 'parallèle avec pc')
    kind, op = kinds[op1 & 7], ops[op2]
    insn.mnem = 'parallel'
    if kind in (0, 3):
        insn.lines = ['u32 g = ge; %s = rt_parallel(%d, %d, %s, %s, &g); ge = g;'
                      % (REGS[rd], kind, op, REGS[rn], REGS[rm])]
    else:
        insn.lines = ['u32 g = 0; %s = rt_parallel(%d, %d, %s, %s, &g);' % (REGS[rd], kind, op, REGS[rn], REGS[rm])]
    return insn


def _pack_sat_ext(insn, ctx):
    w = insn.word
    op1 = (w >> 20) & 0xFF
    op2 = (w >> 5) & 7
    rd, rn, rm = (w >> 12) & 15, (w >> 16) & 15, w & 15
    rot = ((w >> 10) & 3) * 8
    if rd == 15 or rm == 15:
        return _bad(insn, 'média avec pc')
    low = (w >> 4) & 15                                  # bits 7:4
    # PKHBT / PKHTB
    if op1 == 0x68 and (low & 3) == 1:
        if rn == 15:
            return _bad(insn, 'pkh pc')
        sh = (w >> 7) & 31
        if (w >> 6) & 1:
            insn.mnem = 'pkhtb'
            v = '((u32)((s32)%s >> %d))' % (REGS[rm], sh if sh else 31)
            insn.lines = ['%s = (%s & 0xffff0000u) | (%s & 0xffffu);' % (REGS[rd], REGS[rn], v)]
        else:
            insn.mnem = 'pkhbt'
            insn.lines = ['%s = (%s & 0xffffu) | ((%s << %d) & 0xffff0000u);' % (REGS[rd], REGS[rn], REGS[rm], sh)]
        return insn
    if low == 0xB and op1 == 0x68:                      # SEL
        if rn == 15:
            return _bad(insn, 'sel pc')
        insn.mnem = 'sel'
        insn.lines = ['u32 m = ((ge & 1u) ? 0xffu : 0) | ((ge & 2u) ? 0xff00u : 0) | ((ge & 4u) ? 0xff0000u : 0) | '
                      '((ge & 8u) ? 0xff000000u : 0);', '%s = (%s & m) | (%s & ~m);' % (REGS[rd], REGS[rn], REGS[rm])]
        return insn
    x = 'ror32(%s, %d)' % (REGS[rm], rot) if rot else REGS[rm]
    if low == 7 and op1 in (0x68, 0x6A, 0x6B, 0x6C, 0x6E, 0x6F):       # extensions
        acc = rn != 15
        names = {0x68: 'sxtb16', 0x6A: 'sxtb', 0x6B: 'sxth', 0x6C: 'uxtb16', 0x6E: 'uxtb', 0x6F: 'uxth'}
        insn.mnem = names[op1].replace('xt', 'xta') if acc else names[op1]
        ex = {0x6A: '(u32)(s32)(int8_t)%s', 0x6B: '(u32)(s32)(int16_t)%s', 0x6E: '(%s & 0xffu)',
              0x6F: '(%s & 0xffffu)'}
        if op1 in ex:
            e = ex[op1] % 'ex'
            insn.lines = ['u32 ex = %s;' % x, '%s = %s%s;' % (REGS[rd], (REGS[rn] + ' + ') if acc else '', e)]
        elif op1 == 0x68:
            lo = '(u32)(s32)(int8_t)ex'
            hi = '(u32)(s32)(int8_t)(ex >> 16)'
            if acc:
                insn.lines = ['u32 ex = %s;' % x,
                              '%s = (((%s & 0xffffu) + (%s & 0xffffu)) & 0xffffu) | ((((%s >> 16) + (%s)) & 0xffffu) << 16);'
                              % (REGS[rd], REGS[rn], lo, REGS[rn], hi)]
            else:
                insn.lines = ['u32 ex = %s;' % x, '%s = (%s & 0xffffu) | (((%s) & 0xffffu) << 16);' % (REGS[rd], lo, hi)]
        else:
            if acc:
                insn.lines = ['u32 ex = %s;' % x,
                              '%s = (((%s & 0xffffu) + (ex & 0xffu)) & 0xffffu) | ((((%s >> 16) + ((ex >> 16) & 0xffu)) & 0xffffu) << 16);'
                              % (REGS[rd], REGS[rn], REGS[rn])]
            else:
                insn.lines = ['u32 ex = %s;' % x, '%s = ex & 0x00ff00ffu;' % REGS[rd]]
        return insn
    if op1 in (0x6A, 0x6B) and not (w & 0x20) and (w & 0x10):    # SSAT
        sat = ((w >> 16) & 31) + 1
        sh = (w >> 7) & 31
        insn.mnem = 'ssat'
        if (w >> 6) & 1:
            v = '((s64)((s32)%s >> %d))' % (REGS[rm], sh if sh else 31) if sh else '((s64)((s32)%s >> 31))' % REGS[rm]
        else:
            v = '((s64)(s32)(%s << %d))' % (REGS[rm], sh)
        insn.lines = ['%s = (u32)ssat32(%s, %d, &qf);' % (REGS[rd], v, sat)]
        return insn
    if op1 in (0x6E, 0x6F) and not (w & 0x20) and (w & 0x10):    # USAT
        sat = (w >> 16) & 31
        sh = (w >> 7) & 31
        insn.mnem = 'usat'
        if (w >> 6) & 1:
            v = '((s64)((s32)%s >> %d))' % (REGS[rm], sh if sh else 31) if sh else '((s64)((s32)%s >> 31))' % REGS[rm]
        else:
            v = '((s64)(s32)(%s << %d))' % (REGS[rm], sh)
        insn.lines = ['%s = usat32(%s, %d, &qf);' % (REGS[rd], v, sat)]
        return insn
    if op1 == 0x6A and low == 3 and (w & 0xF00) == 0xF00:       # SSAT16
        sat = ((w >> 16) & 15) + 1
        insn.mnem = 'ssat16'
        insn.lines = ['%s = ((u32)ssat32((int16_t)%s, %d, &qf) & 0xffffu) | ((u32)ssat32((int16_t)(%s >> 16), %d, &qf) << 16);'
                      % (REGS[rd], REGS[rm], sat, REGS[rm], sat)]
        return insn
    if op1 == 0x6E and low == 3 and (w & 0xF00) == 0xF00:       # USAT16
        sat = (w >> 16) & 15
        insn.mnem = 'usat16'
        insn.lines = ['%s = (usat32((int16_t)%s, %d, &qf) & 0xffffu) | (usat32((int16_t)(%s >> 16), %d, &qf) << 16);'
                      % (REGS[rd], REGS[rm], sat, REGS[rm], sat)]
        return insn
    if op1 == 0x6B and low == 3 and (w & 0xF0F00) == 0xF0F00:   # REV
        insn.mnem = 'rev'
        insn.lines = ['%s = __builtin_bswap32(%s);' % (REGS[rd], REGS[rm])]
        return insn
    if op1 == 0x6B and low == 0xB and (w & 0xF0F00) == 0xF0F00:  # REV16
        insn.mnem = 'rev16'
        insn.lines = ['%s = ((%s & 0x00ff00ffu) << 8) | ((%s >> 8) & 0x00ff00ffu);' % (REGS[rd], REGS[rm], REGS[rm])]
        return insn
    if op1 == 0x6F and low == 0xB and (w & 0xF0F00) == 0xF0F00:  # REVSH
        insn.mnem = 'revsh'
        insn.lines = ['%s = (u32)(s32)(int16_t)__builtin_bswap16((u16)%s);' % (REGS[rd], REGS[rm])]
        return insn
    return _bad(insn, 'empaquetage, saturation ou extension non couverts')


def _dual_mul(insn, ctx):
    w = insn.word
    op1 = (w >> 20) & 0xFF
    rd, ra, rs, rm = (w >> 16) & 15, (w >> 12) & 15, (w >> 8) & 15, w & 15
    op2 = (w >> 5) & 7
    sub = (op2 >> 1) & 1
    swap = op2 & 1
    if (w & 0x10) == 0 or (op2 & 4) or 15 in (rd, rs, rm):
        return _bad(insn, 'double multiplication non couverte')
    y = 'ror32(%s, 16)' % REGS[rs] if swap else REGS[rs]
    L = ['u32 y = %s;' % y,
         's64 p1 = (s64)sx16(%s) * sx16(y), p2 = (s64)sx16(%s >> 16) * sx16(y >> 16);' % (REGS[rm], REGS[rm])]
    comb = 'p1 - p2' if sub else 'p1 + p2'
    if op1 == 0x70:
        insn.mnem = ('smlsd' if sub else 'smlad') if ra != 15 else ('smusd' if sub else 'smuad')
        if ra != 15:
            L += ['s64 s = %s + (s64)(s32)%s;' % (comb, REGS[ra])]
        else:
            L += ['s64 s = %s;' % comb]
        L += ['if (s != (s64)(s32)s) qf = 1;', '%s = (u32)s;' % REGS[rd]]
    else:
        if 15 in (ra,):
            return _bad(insn, 'smlald pc')
        insn.mnem = 'smlsld' if sub else 'smlald'
        hi, lo = rd, ra
        L += ['u64 s = (((u64)%s << 32) | %s) + (u64)(%s);' % (REGS[hi], REGS[lo], comb),
              '%s = (u32)s; %s = (u32)(s >> 32);' % (REGS[lo], REGS[hi])]
    insn.lines = L
    return insn


def _mul_high(insn, ctx):
    w = insn.word
    rd, ra, rs, rm = (w >> 16) & 15, (w >> 12) & 15, (w >> 8) & 15, w & 15
    op2 = (w >> 5) & 7
    rnd = op2 & 1
    kind = op2 >> 1
    if 15 in (rd, rs, rm) or kind not in (0, 3) or (w & 0x10) == 0:
        return _bad(insn, 'smmul non couvert')
    insn.mnem = {0: 'smmla', 3: 'smmls'}[kind] if ra != 15 or kind == 3 else 'smmul'
    L = ['s64 p = (s64)(s32)%s * (s64)(s32)%s;' % (REGS[rm], REGS[rs])]
    if kind == 3 and ra == 15:
        return _bad(insn, 'smmls pc')
    if kind == 0:
        L += ['s64 s = %s + p;' % ('(s64)(s32)%s * 4294967296LL' % REGS[ra] if ra != 15 else '0')]
    else:
        L += ['s64 s = (s64)(s32)%s * 4294967296LL - p;' % REGS[ra]]
    if rnd:
        L += ['s += 0x80000000LL;']
    L += ['%s = (u32)((u64)s >> 32);' % REGS[rd]]
    insn.lines = L
    return insn


# --- coprocesseurs ---------------------------------------------------------------------------------------------------

def _coproc_mem(insn, ctx):
    import vfpdec
    return vfpdec.decode_mem(insn, ctx)


def _coproc_reg(insn, ctx):
    w = insn.word
    cp = (w >> 8) & 15
    if cp in (10, 11):
        import vfpdec
        return vfpdec.decode_reg(insn, ctx)
    if (w & 0x0FF00FFF) == 0x0E100F70 or (w & 0x0FF00FFF) == 0x0E100F70 | 0:
        pass
    # mcr p15, 0, rt, c7, ... : entretien des caches et barrières (DSB, DMB, vidage du tampon d'instructions) :
    # le recompilé n'a pas de cache à tenir, et il tourne dans un seul fil de l'hôte pour l'instant.
    if (w & 0x0F1F0F10) == 0x0E070F10:
        insn.mnem = 'mcr'
        insn.lines = ['/* mcr p15, c7 : cache ou barrière */']
        return insn
    # mrc p15, 0, rd, c13, c0, 3 : le registre du stockage local du fil
    if (w & 0x0FFF0FFF) == 0x0E1D0F70:
        rd = (w >> 12) & 15
        if rd == 15:
            return _bad(insn, 'mrc pc')
        insn.mnem = 'mrc'
        insn.lines = ['%s = c->tls;' % REGS[rd]]
        return insn
    return _bad(insn, 'coprocesseur %d non couvert' % cp)
