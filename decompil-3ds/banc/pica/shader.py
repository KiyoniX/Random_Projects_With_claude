"""L'interpréteur des shaders de sommets du PICA200.

Le programme tourne pour tous les sommets d'un ordre de dessin à la fois : chaque registre est un tableau numpy
(sommets, 4). Si un branchement dépend d'une comparaison qui n'est pas la même pour tous les sommets, on rejoue les
sommets un par un (rare). Les flottants sont des float32 (la console a des float24 : la différence est ignorée).

Les registres : 0x00-0x0F entrées (v), 0x10-0x1F temporaires (r) pour les sources ; 0x20-0x7F constantes flottantes (c).
Destinations : 0x00-0x0F sorties (o), 0x10-0x1F temporaires.
"""
import numpy as np

OP_ADD, OP_DP3, OP_DP4, OP_DPH, OP_DST, OP_EX2, OP_LG2, OP_LITP, OP_MUL, OP_SGE, OP_SLT, OP_FLR, OP_MAX, OP_MIN, \
    OP_RCP, OP_RSQ = range(16)
OP_MOVA, OP_MOV = 0x12, 0x13
OP_DPHI, OP_DSTI, OP_SGEI, OP_SLTI = 0x18, 0x19, 0x1A, 0x1B
OP_BREAK, OP_NOP, OP_END, OP_BREAKC, OP_CALL, OP_CALLC, OP_CALLU, OP_IFU, OP_IFC, OP_LOOP, OP_EMIT, OP_SETEMIT, \
    OP_JMPC, OP_JMPU = range(0x20, 0x2E)
OP_CMP = 0x2E          # et 0x2F
OP_MADI = 0x30         # 0x30 à 0x37
OP_MAD = 0x38          # 0x38 à 0x3F

MAX_STEPS = 200000
IDENTITY = (0, 1, 2, 3)


class Divergence(Exception):
    """Un branchement n'a pas la même issue pour tous les sommets."""


def f24_to_f32(raw):
    """Flottants 24 bits du PICA (1 signe, 7 exposant biaisé de 63, 16 mantisse) -> float32."""
    raw = np.asarray(raw, dtype=np.uint32) & 0xFFFFFF
    sign = (raw >> 23) & 1
    exponent = (raw >> 16) & 0x7F
    mantissa = raw & 0xFFFF
    bits = (sign << 31) | ((exponent + 64) << 23) | (mantissa << 7)
    bits = np.where(exponent == 0, sign << 31, bits)
    bits = np.where(exponent == 0x7F, (sign << 31) | (0xFF << 23) | np.where(mantissa != 0, 1 << 22, 0), bits)
    return bits.astype(np.uint32).view(np.float32)


def f32_to_f24(values):
    """float32 -> flottant 24 bits (utile aux tests)."""
    bits = np.asarray(values, dtype=np.float32).view(np.uint32).astype(np.int64)
    sign = (bits >> 31) & 1
    exponent = (bits >> 23) & 0xFF
    mantissa = (bits >> 7) & 0xFFFF
    new_exp = exponent - 64
    raw = (sign << 23) | (np.clip(new_exp, 0, 0x7F) << 16) | mantissa
    return np.where(new_exp <= 0, sign << 23, raw).astype(np.uint32)


def multiply(a, b):
    """La multiplication du PICA : zéro fois n'importe quoi (même l'infini) donne zéro."""
    r = a * b
    bad = np.isnan(r)
    if bad.any():
        r = np.where(bad, np.float32(0), r)
    return r


COMPARE = (lambda a, b: a == b, lambda a, b: a != b, lambda a, b: a < b, lambda a, b: a <= b,
           lambda a, b: a > b, lambda a, b: a >= b, lambda a, b: np.ones_like(a, dtype=bool),
           lambda a, b: np.ones_like(a, dtype=bool))


class VertexShader:
    def __init__(self):
        self.code = [0] * 4096
        self.swizzle = [0] * 4096
        self.uniforms = np.zeros((96, 4), dtype=np.float32)
        self.bools = 0                    # 16 bits
        self.ints = [(0, 0, 0)] * 4
        self.entry = 0
        self.unsupported = set()
        self.steps = 0
        # état d'une exécution
        self.n = 0

    # --- l'exécution ---

    def run(self, inputs):
        """inputs : (n, 16, 4) float32 -> sorties (n, 16, 4) float32."""
        n = len(inputs)
        try:
            return self._run(inputs)
        except Divergence:
            if n == 1:
                raise
            return np.concatenate([self.run(inputs[i:i + 1]) for i in range(n)], axis=0)

    def _run(self, inputs):
        n = len(inputs)
        self.n = n
        self.inp = inputs
        self.tmp = np.zeros((n, 16, 4), dtype=np.float32)
        self.out = np.zeros((n, 16, 4), dtype=np.float32)
        self.addr = np.zeros((n, 2), dtype=np.int64)
        self.loop_counter = 0
        self.cmp = np.zeros((n, 2), dtype=bool)
        self.steps = 0
        with np.errstate(all='ignore'):
            self._block(self.entry, 4096)
        return self.out

    def _source(self, index, selector, negate, offset=0):
        if isinstance(offset, np.ndarray):
            if index < 0x20:
                base = self.inp if index < 0x10 else self.tmp
                raw = base[np.arange(self.n), np.clip((index & 15) + offset, 0, 15)]
            else:
                raw = self.uniforms[np.clip(index - 0x20 + offset, 0, 95)]
        else:
            index += offset
            if index < 0x10:
                raw = self.inp[:, index]
            elif index < 0x20:
                raw = self.tmp[:, index - 0x10]
            else:
                raw = self.uniforms[min(index - 0x20, 95)][None, :]
        if selector != IDENTITY:
            raw = raw[:, selector]
        return -raw if negate else raw

    SEL_CACHE = {}

    def _decode_sel(self, desc, which):
        """(sélecteur de composantes, négation) de la source 1, 2 ou 3 d'un descripteur."""
        key = (desc, which)
        found = self.SEL_CACHE.get(key)
        if found is None:
            if which == 1:
                found = (desc >> 11 & 3, desc >> 9 & 3, desc >> 7 & 3, desc >> 5 & 3), desc >> 4 & 1
            elif which == 2:
                found = (desc >> 20 & 3, desc >> 18 & 3, desc >> 16 & 3, desc >> 14 & 3), desc >> 13 & 1
            else:
                found = (desc >> 29 & 3, desc >> 27 & 3, desc >> 25 & 3, desc >> 23 & 3), desc >> 22 & 1
            self.SEL_CACHE[key] = found
        return found

    MASK_INDEX = {m: [c for c in range(4) if m & (8 >> c)] for m in range(16)}

    def _write(self, dest, mask, value):
        target = self.out if dest < 0x10 else self.tmp
        slot = dest & 15
        if value.shape[0] != self.n:
            value = np.broadcast_to(value, (self.n, value.shape[1]))
        if value.shape[1] != 4:
            value = np.broadcast_to(value, (self.n, 4))
        if mask == 15:
            target[:, slot] = value
        else:
            idx = self.MASK_INDEX[mask]
            if idx:
                target[:, slot, idx] = value[:, idx]

    def _condition(self, instr):
        op = instr >> 22 & 3
        ref_y = instr >> 24 & 1
        ref_x = instr >> 25 & 1
        cx = self.cmp[:, 0] == bool(ref_x)
        cy = self.cmp[:, 1] == bool(ref_y)
        result = (cx | cy, cx & cy, cx, cy)[op]
        if result.all():
            return True
        if not result.any():
            return False
        raise Divergence()

    def _block(self, pc, end):
        """Exécute les instructions [pc, end). Rend 'end' si END a été rencontré, 'break' pour BREAK, sinon None."""
        code = self.code
        while pc < end:
            self.steps += 1
            if self.steps > MAX_STEPS:
                return 'end'
            instr = code[pc]
            op = instr >> 26
            if op < 0x20 or op >= 0x2E:
                self._arith(instr, op)
                pc += 1
                continue
            dest = instr >> 10 & 0xFFF
            count = instr & 0xFF
            if op == OP_END:
                return 'end'
            if op == OP_NOP or op == OP_EMIT or op == OP_SETEMIT:
                pc += 1
            elif op == OP_BREAK:
                return 'break'
            elif op == OP_BREAKC:
                if self._condition(instr):
                    return 'break'
                pc += 1
            elif op in (OP_CALL, OP_CALLC, OP_CALLU):
                if op == OP_CALL or (op == OP_CALLC and self._condition(instr)) or \
                        (op == OP_CALLU and self.bools >> (instr >> 22 & 15) & 1):
                    if self._block(dest, dest + count) == 'end':
                        return 'end'
                pc += 1
            elif op in (OP_IFU, OP_IFC):
                if op == OP_IFU:
                    taken = bool(self.bools >> (instr >> 22 & 15) & 1)
                else:
                    taken = self._condition(instr)
                if taken:
                    result = self._block(pc + 1, dest)
                else:
                    result = self._block(dest, dest + count) if count else None
                if result:
                    return result
                pc = dest + count
            elif op == OP_LOOP:
                x, y, z = self.ints[instr >> 22 & 3]
                result = None
                for i in range(x + 1):
                    self.addr_loop = (y + i * z) & 0xFF
                    result = self._block(pc + 1, dest + 1)
                    if result:
                        break
                if result == 'end':
                    return 'end'
                pc = dest + 1
            elif op == OP_JMPC:
                pc = dest if self._condition(instr) else pc + 1
            elif op == OP_JMPU:
                invert = count & 1
                pc = dest if bool(self.bools >> (instr >> 22 & 15) & 1) == (not invert) else pc + 1
            else:
                self.unsupported.add(op)
                pc += 1
        return None

    addr_loop = 0

    def _offset(self, index_register):
        if index_register == 0:
            return 0
        if index_register == 3:
            return self.addr_loop
        return self.addr[:, index_register - 1]

    def _arith(self, instr, op):
        if op >= OP_MAD:
            desc = self.swizzle[instr & 0x1F]
            inverted = False
            src1 = instr >> 17 & 0x1F
            src2 = instr >> 10 & 0x7F
            src3 = instr >> 5 & 0x1F
            idx = instr >> 22 & 3
            dest = instr >> 24 & 0x1F
            off = self._offset(idx)
            a = self._source(src1, *self._decode_sel(desc, 1))
            b = self._source(src2, *self._decode_sel(desc, 2), offset=off)
            c = self._source(src3, *self._decode_sel(desc, 3))
            self._write(dest, desc & 15, multiply(a, b) + c)
            return
        if op >= OP_MADI:
            desc = self.swizzle[instr & 0x1F]
            src1 = instr >> 17 & 0x1F
            src2 = instr >> 12 & 0x1F
            src3 = instr >> 5 & 0x7F
            idx = instr >> 22 & 3
            dest = instr >> 24 & 0x1F
            off = self._offset(idx)
            a = self._source(src1, *self._decode_sel(desc, 1))
            b = self._source(src2, *self._decode_sel(desc, 2))
            c = self._source(src3, *self._decode_sel(desc, 3), offset=off)
            self._write(dest, desc & 15, multiply(a, b) + c)
            return
        desc = self.swizzle[instr & 0x7F]
        idx = instr >> 19 & 3
        dest = instr >> 21 & 0x1F
        inverted = op in (OP_DPHI, OP_DSTI, OP_SGEI, OP_SLTI)
        if inverted:
            src1 = instr >> 14 & 0x1F
            src2 = instr >> 7 & 0x7F
            off1, off2 = 0, self._offset(idx)
        else:
            src1 = instr >> 12 & 0x7F
            src2 = instr >> 7 & 0x1F
            off1, off2 = self._offset(idx), 0
        if op == OP_CMP or op == OP_CMP + 1:
            a = self._source(src1, *self._decode_sel(desc, 1), offset=off1)
            b = self._source(src2, *self._decode_sel(desc, 2), offset=off2)
            op_x = instr >> 24 & 7
            op_y = instr >> 21 & 7
            self.cmp[:, 0] = COMPARE[op_x](a[:, 0], b[:, 0])
            self.cmp[:, 1] = COMPARE[op_y](a[:, 1], b[:, 1])
            return
        a = self._source(src1, *self._decode_sel(desc, 1), offset=off1)
        mask = desc & 15
        if op in (OP_MOV, OP_FLR, OP_MOVA, OP_RCP, OP_RSQ, OP_EX2, OP_LG2, OP_LITP):
            if op == OP_MOV:
                self._write(dest, mask, a)
            elif op == OP_FLR:
                self._write(dest, mask, np.floor(a))
            elif op == OP_MOVA:
                if mask & 8:
                    self.addr[:, 0] = np.clip(np.trunc(np.nan_to_num(a[:, 0])), -128, 127).astype(np.int64)
                if mask & 4:
                    self.addr[:, 1] = np.clip(np.trunc(np.nan_to_num(a[:, 1])), -128, 127).astype(np.int64)
            elif op == OP_RCP:
                self._write(dest, mask, (np.float32(1) / a[:, 0])[:, None])
            elif op == OP_RSQ:
                self._write(dest, mask, (np.float32(1) / np.sqrt(a[:, 0]))[:, None])
            elif op == OP_EX2:
                self._write(dest, mask, np.exp2(a[:, 0])[:, None])
            elif op == OP_LG2:
                self._write(dest, mask, np.log2(a[:, 0])[:, None])
            else:
                self.unsupported.add(op)
            return
        b = self._source(src2, *self._decode_sel(desc, 2), offset=off2)
        if op == OP_ADD:
            r = a + b
        elif op == OP_MUL:
            r = multiply(a, b)
        elif op == OP_DP3:
            r = multiply(a[:, :3], b[:, :3]).sum(axis=1)[:, None]
        elif op == OP_DP4:
            r = multiply(a, b).sum(axis=1)[:, None]
        elif op in (OP_DPH, OP_DPHI):
            r = (multiply(a[:, :3], b[:, :3]).sum(axis=1) + b[:, 3])[:, None]
        elif op in (OP_DST, OP_DSTI):
            cols = np.broadcast_arrays(np.ones(self.n, np.float32), multiply(a[:, 1], b[:, 1]), a[:, 2], b[:, 3])
            r = np.stack(cols, axis=1)
        elif op in (OP_SGE, OP_SGEI):
            r = (a >= b).astype(np.float32)
        elif op in (OP_SLT, OP_SLTI):
            r = (a < b).astype(np.float32)
        elif op == OP_MAX:
            r = np.maximum(a, b)
        elif op == OP_MIN:
            r = np.minimum(a, b)
        else:
            self.unsupported.add(op)
            return
        self._write(dest, mask, r)
