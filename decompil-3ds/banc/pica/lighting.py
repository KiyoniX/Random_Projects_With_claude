"""L'éclairage par fragment du PICA200 (registres 0x08F et 0x140-0x1FF).

Pour chaque fragment, le matériel prend la normale (un quaternion interpolé, sorti du shader) et le vecteur vers
l'œil, puis, pour chaque lumière allumée, il calcule un cosinus d'entrée (N.L, N.H, V.H, N.V, L.P, un angle), le passe
dans une table de consultation (LUT) et le multiplie par la couleur de la lumière. La somme donne deux couleurs : la
« primaire » (ambiante globale + diffus) et la « secondaire » (spéculaire). Le combinateur les lit comme sources 1 et 2.
Quand l'éclairage est allumé, la couleur du sommet n'entre plus dans la couleur primaire de fragment.

Les registres, d'après 3dbrew (GPU/Internal Registers, lumières) :
- 0x140 + 0x10 * i : lumière i. +0 spéculaire 0, +1 spéculaire 1, +2 diffus, +3 ambiante (trois champs de 10 bits : bleu,
  vert, rouge, sur 255) ; +4 position x, y (flottants 16 bits), +5 position z ; +6 direction du spot x, y (entiers signés de
  13 bits sur 2047), +7 z ; +9 configuration (bit 0 : directionnelle, bit 1 : deux faces, bits 2 et 3 : facteur
  géométrique pour le spéculaire 0 et 1) ; +10 et +11 biais et échelle de l'atténuation (flottants 20 bits).
- 0x1C0 : ambiante globale ; 0x1C2 : nombre de lumières moins un ; 0x1C3 : configuration 0 (bit 0 ombre, bits 2 et 3 la
  sortie du Fresnel vers l'alpha primaire et secondaire, bits 4-7 le mode, bits 16-19 l'ombre sur primaire, secondaire,
  inversée, alpha, bits 22-23 la texture du relief, 24-25 celle de l'ombre, bit 27 l'écrêtage des reflets, bits 28-29 le
  mode de relief, bit 30 pas de renormalisation) ; 0x1C4 : configuration 1 (un bit levé par table éteinte : ombre 0-7,
  spot 8-15, D0 16, D1 17, Fresnel 19, rouge 20, vert 21, bleu 22, distance 24-31) ; 0x1C5 : index de table (bits 0-7 la
  ligne, 8-12 la table) ; 0x1C8-0x1CF : données de table (le port s'incrémente à chaque écriture) ; 0x1D0 : « signé »
  par table (bit 1 de chaque rang de 4 bits) ; 0x1D1 : entrée de chaque table ; 0x1D2 : échelle de chaque table ;
  0x1D9 : quelle lumière dans quelle case (4 bits par case).
- Les 24 tables : 0 D0, 1 D1, 3 FR (Fresnel), 4 RB, 5 RG, 6 RR (réflexion), 8 à 15 SP (spot, une par lumière), 16 à 23 DA
  (atténuation de distance, une par lumière). Une ligne : valeur sur 12 bits (0..1) et différence signée sur 12 bits ;
  on lit `valeur + différence * fraction`.

Le comportement a été relevé sur le rendu logiciel de Citra/Azahar (sw_lighting.cpp, regs_lighting.h), lu comme
documentation : l'échelle d'une table s'applique à sa SORTIE, la valeur absolue dépend du drapeau « deux faces » de la
lumière, l'angle du spot est L.P (sans signe moins), le Fresnel ne vaut que pour la dernière case, et le mode de
configuration décide quelles tables existent.

Ce qui n'est pas fait : le mode de relief « carte de tangentes » est fait comme la carte de normales sans test sur du jeu
réel ; rien n'a été comparé à une vraie console.
"""
import numpy as np

LUT_COUNT = 24
LUT_D0, LUT_D1, LUT_FR, LUT_RB, LUT_RG, LUT_RR, LUT_SP, LUT_DA = 0, 1, 3, 4, 5, 6, 8, 16
# la place de chaque table dans les registres d'entrée, d'échelle et de valeur absolue (rang de 4 bits)
INPUT_SLOT = {LUT_D0: 0, LUT_D1: 1, LUT_SP: 2, LUT_FR: 3, LUT_RB: 4, LUT_RG: 5, LUT_RR: 6}
DISABLE_BIT = {LUT_D0: 16, LUT_D1: 17, LUT_FR: 19, LUT_RR: 20, LUT_RG: 21, LUT_RB: 22}     # dans 0x1C4
SCALES = (1.0, 2.0, 4.0, 8.0, 1.0, 1.0, 0.25, 0.5)
# Les tables qui existent selon le mode (bits 4-7 de 0x1C3) : 0 rouge+D0+spot ; 1 rouge+Fresnel+spot ; 2 rouge+D0+D1 ;
# 3 D0+D1+Fresnel ; 4 RVB+D0+D1+spot ; 5 RVB+D0+Fresnel+spot ; 6 rouge+D0+D1+Fresnel+spot ; 8 tout (7 n'existe pas).
MISSING_IN_MODES = {LUT_D0: (1,), LUT_D1: (0, 1, 5), LUT_SP: (2, 3), LUT_FR: (0, 2, 4), LUT_RR: (3,)}
RGB_MODES = (4, 5, 8)


def supported(mode, which):
    """La table `which` (de base : D0, D1, FR, RR, RG, RB ou SP) existe-t-elle dans ce mode de configuration ?"""
    if which in MISSING_IN_MODES:
        return mode not in MISSING_IN_MODES[which]
    return mode in RGB_MODES                                       # vert et bleu


def f16(bits):
    return np.asarray(bits, dtype=np.uint16).view(np.float16).astype(np.float32)


def f20(bits):
    """Flottant de 20 bits (1 signe, 7 exposant biaisé de 63, 12 mantisse) -> float32."""
    bits = int(bits) & 0xFFFFF
    sign, exponent, mantissa = bits >> 19 & 1, bits >> 12 & 0x7F, bits & 0xFFF
    if exponent == 0:
        return -0.0 if sign else 0.0
    return float(np.uint32((sign << 31) | ((exponent + 64) << 23) | (mantissa << 11)).view(np.float32))


def color10(word):
    return np.array([word >> 20 & 0x3FF, word >> 10 & 0x3FF, word & 0x3FF], dtype=np.float32) / 255


def signed_bits(value, bits):
    value &= (1 << bits) - 1
    return value - (1 << bits) if value >> (bits - 1) else value


class Luts:
    """Les 24 tables de consultation : (24, 256, 2) de float32 (valeur, différence), écrites par 0x1C5 et 0x1C8-0x1CF."""

    def __init__(self):
        self.table = np.zeros((LUT_COUNT, 256, 2), dtype=np.float32)
        self.which = 0
        self.row = 0

    def set_index(self, word):
        self.row = word & 0xFF
        self.which = word >> 8 & 0x1F

    def push(self, word):
        if self.which < LUT_COUNT and self.row < 256:
            value = word & 0xFFF
            diff = word >> 12 & 0xFFF
            if diff & 0x800:
                diff -= 0x1000
            self.table[self.which, self.row] = (value / 4096.0, diff / 4096.0)
        self.row += 1


def lookup(luts, which, x, signed, two_sided=False):
    """Une table lue pour des entrées x dans [-1, 1].

    Sans `signed` : l'entrée est ramenée à [0, 1] (valeur absolue si `two_sided`, sinon les négatives valent 0), ligne
    = plancher de 256 x. Avec `signed` : ligne = plancher de 128 x, les négatives sont les lignes 128 à 255."""
    t = luts.table[which]
    x = np.asarray(x, dtype=np.float32)
    if signed:
        scaled = x * 128
        row = np.clip(np.floor(scaled), -128, 127)
        index = row.astype(np.int64) & 255
    else:
        x = np.abs(x) if two_sided else np.maximum(x, 0)
        scaled = x * 256
        row = np.clip(np.floor(scaled), 0, 255)
        index = row.astype(np.int64)
    return t[index, 0] + t[index, 1] * (scaled - row)


def quaternion_rotate(q, v):
    """Tourne les vecteurs v (n, 3) par les quaternions q (n, 4 : x y z w) : v + 2 q.xyz x (q.xyz x v + w v)."""
    qv = q[:, :3]
    inner = np.cross(qv, v) + q[:, 3:4] * v
    return v + 2 * np.cross(qv, inner)


def normalize(v):
    length = np.sqrt((v * v).sum(axis=1, keepdims=True))
    return v / np.where(length > 1e-12, length, 1)


def light_order(regs):
    """Les numéros des lumières allumées, dans l'ordre des cases de 0x1D9."""
    count = (regs[0x1C2] & 7) + 1
    return [regs[0x1D9] >> (4 * k) & 7 for k in range(count)]


def dot(a, b):
    return (a * b).sum(axis=1)


def shade(regs, luts, frag, textures=None):
    """Éclairage de m fragments. frag : (m, 18) attributs interpolés (vue en 11-13, quaternion en 14-17).

    `textures` : liste de quatre tableaux (m, 4) dans [0, 1] (les trois unités et une case vide), pour le relief et
    l'ombre. Rend (primaire (m, 4), secondaire (m, 4)) en float32 dans [0, 1].
    """
    m = len(frag)
    if textures is None:
        textures = [np.zeros((m, 4), dtype=np.float32)] * 4
    quaternion = frag[:, 14:18].astype(np.float32)
    quaternion = quaternion / np.maximum(np.sqrt((quaternion ** 2).sum(axis=1, keepdims=True)), 1e-12)
    config0, config1 = regs[0x1C3], regs[0x1C4]
    mode = config0 >> 4 & 15
    # le relief : la normale (ou la tangente) vient d'une texture
    surface_normal = np.zeros((m, 3), dtype=np.float32)
    surface_tangent = np.zeros((m, 3), dtype=np.float32)
    surface_normal[:, 2] = 1
    surface_tangent[:, 0] = 1
    bump_mode = config0 >> 28 & 3
    if bump_mode:
        perturbation = (textures[config0 >> 22 & 3][:, :3] * 255 / 127.5 - 1).astype(np.float32)
        if bump_mode == 1:
            if not config0 >> 30 & 1:
                perturbation[:, 2] = np.sqrt(np.maximum(1 - (perturbation[:, :2] ** 2).sum(axis=1), 0))
            surface_normal = perturbation
        else:
            surface_tangent = perturbation
    normal = quaternion_rotate(quaternion, surface_normal)
    tangent = quaternion_rotate(quaternion, surface_tangent)
    view = frag[:, 11:14].astype(np.float32)
    view_n = normalize(view)
    shadow = np.ones((m, 4), dtype=np.float32)
    if config0 & 1:
        shadow = textures[config0 >> 24 & 3].astype(np.float32)
        if config0 >> 18 & 1:
            shadow = 1 - shadow
    diffuse_sum = np.zeros((m, 3), dtype=np.float32)
    specular_sum = np.zeros((m, 3), dtype=np.float32)
    alpha_primary = np.ones(m, dtype=np.float32)
    alpha_secondary = np.ones(m, dtype=np.float32)
    last = regs[0x1C2] & 7
    for slot, light_id in enumerate(light_order(regs)):
        b = 0x140 + 0x10 * light_id
        position = np.array([f16(regs[b + 4] & 0xFFFF), f16(regs[b + 4] >> 16 & 0xFFFF), f16(regs[b + 5] & 0xFFFF)],
                            dtype=np.float32)
        light_config = regs[b + 9]
        two_sided = bool(light_config >> 1 & 1)
        light = np.broadcast_to(position, (m, 3)) if light_config & 1 else position[None, :] + view
        length = np.sqrt(dot(light, light))
        light_n = normalize(light)
        half = view_n + light_n
        half_n = normalize(half)
        spot_dir = np.array([signed_bits(regs[b + 6], 13), signed_bits(regs[b + 6] >> 16, 13),
                             signed_bits(regs[b + 7], 13)], dtype=np.float32) / 2047
        inputs = {0: dot(normal, half_n), 1: dot(view_n, half_n), 2: dot(normal, view_n), 3: dot(light_n, normal),
                  4: (light_n * spot_dir[None, :]).sum(axis=1)}
        if mode == 8:
            inputs[5] = dot(half_n - normal * dot(normal, half_n)[:, None], tangent)
        else:
            inputs[5] = np.zeros(m, dtype=np.float32)

        def table(which, enabled=True):
            """La sortie d'une table (avec son échelle), ou None si elle est éteinte ou n'existe pas dans ce mode."""
            base = LUT_SP if which >= LUT_SP else which
            if not enabled or not supported(mode, base):
                return None
            if base in DISABLE_BIT and config1 >> DISABLE_BIT[base] & 1:
                return None
            rank = 4 * INPUT_SLOT[base]
            entry = regs[0x1D1] >> rank & 7
            signed = bool(regs[0x1D0] >> (rank + 1) & 1)
            return SCALES[regs[0x1D2] >> rank & 7] * lookup(luts, which, inputs.get(entry, inputs[0]), signed, two_sided)

        distance = np.ones(m, dtype=np.float32)
        if not config1 >> (24 + light_id) & 1:
            sample = np.clip(length * f20(regs[b + 11]) + f20(regs[b + 10]), 0, 1)
            distance = lookup(luts, LUT_DA + light_id, sample, False)
        spot = np.ones(m, dtype=np.float32)
        if not config1 >> (8 + light_id) & 1:
            found = table(LUT_SP + light_id)
            if found is not None:
                spot = found
        d0, d1 = table(LUT_D0), table(LUT_D1)
        red = table(LUT_RR)
        refl = np.ones((m, 3), dtype=np.float32)
        if red is not None:
            refl[:] = red[:, None]
        for channel, which in ((1, LUT_RG), (2, LUT_RB)):
            found = table(which)
            if found is not None:
                refl[:, channel] = found
        spec0 = color10(regs[b])[None, :] * (1 if d0 is None else d0[:, None])
        spec1 = color10(regs[b + 1])[None, :] * (1 if d1 is None else d1[:, None]) * refl
        if slot == last:                                            # le Fresnel : la dernière case seulement
            fresnel = table(LUT_FR)
            if fresnel is not None:
                fresnel = np.clip(fresnel, 0, 1)
                if config0 >> 2 & 1:
                    alpha_primary = fresnel
                if config0 >> 3 & 1:
                    alpha_secondary = fresnel
        dot_ln = dot(light_n, normal)
        dot_ln = np.abs(dot_ln) if two_sided else np.maximum(dot_ln, 0)
        clamp = np.where(dot_ln == 0, 0.0, 1.0)[:, None] if config0 >> 27 & 1 else 1.0
        if light_config & 12:
            half_length2 = dot(half, half)
            geo = np.where(half_length2 == 0, 0, np.minimum(dot_ln / np.maximum(half_length2, 1e-30), 1))[:, None]
            if light_config >> 2 & 1:
                spec0 = spec0 * geo
            if light_config >> 3 & 1:
                spec1 = spec1 * geo
        shadowed = not config1 >> light_id & 1
        shadow_primary = shadow[:, :3] if config0 >> 16 & 1 and shadowed else 1.0
        shadow_secondary = shadow[:, :3] if config0 >> 17 & 1 and shadowed else 1.0
        attenuation = (distance * spot)[:, None]
        diffuse_sum += (color10(regs[b + 2])[None, :] * dot_ln[:, None] * shadow_primary
                        + color10(regs[b + 3])[None, :]) * attenuation
        specular_sum += (spec0 + spec1) * clamp * attenuation * shadow_secondary
    if config0 >> 19 & 1:                                         # l'ombre sur l'alpha, avec le même choix que le Fresnel
        if config0 >> 2 & 1:
            alpha_primary = alpha_primary * shadow[:, 3]
        if config0 >> 3 & 1:
            alpha_secondary = alpha_secondary * shadow[:, 3]
    diffuse_sum += color10(regs[0x1C0])[None, :]
    out_primary = np.ones((m, 4), dtype=np.float32)
    out_secondary = np.ones((m, 4), dtype=np.float32)
    out_primary[:, :3], out_secondary[:, :3] = np.clip(diffuse_sum, 0, 1), np.clip(specular_sum, 0, 1)
    out_primary[:, 3], out_secondary[:, 3] = np.clip(alpha_primary, 0, 1), np.clip(alpha_secondary, 0, 1)
    return out_primary, out_secondary
