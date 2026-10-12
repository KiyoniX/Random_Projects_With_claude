(function () {
  'use strict';

  var PRES = 0.12, LOIN = 6500;          // plans de coupe de la caméra, en mètres
  var PROF_OMBRE = 420;                  // demi-profondeur du volume d'ombre
  var PROCHE = 110;                      // en deçà, les blocs sont dessinés un à un, du plus proche au plus lointain
  var TAILLE_SOL = 2048, TAILLE_MASQUE = 1024;
  var COUCHE = window.VisiteBatir.COUCHE;

  // Réglages de qualité : part des pixels de l'écran, côté de la carte d'ombre (0 : sans ombres) et son rayon, distances de vue.
  var QUALITES = {
    basse: { echelle: 0.6, ombre: 0, rayon: 0, vue: 420, arbres: 240, nuages: 0 },
    moyenne: { echelle: 0.8, ombre: 1536, rayon: 70, vue: 700, arbres: 420, nuages: 1 },
    haute: { echelle: 1, ombre: 2048, rayon: 95, vue: 1500, arbres: 900, nuages: 1 }
  };

  // Le ciel au fil du soleil : hauteur (sinus), couleur du soleil, zénith, horizon, lumière du ciel, lumière renvoyée par le sol.
  var CIELS = [
    [-1.0, [0.10, 0.13, 0.22], [0.010, 0.016, 0.040], [0.030, 0.045, 0.085], [0.045, 0.060, 0.110], [0.020, 0.022, 0.030]],
    [-0.22, [0.10, 0.13, 0.22], [0.012, 0.020, 0.050], [0.040, 0.055, 0.100], [0.050, 0.065, 0.120], [0.022, 0.024, 0.032]],
    [-0.06, [0.00, 0.00, 0.00], [0.070, 0.100, 0.230], [0.560, 0.300, 0.220], [0.160, 0.170, 0.270], [0.070, 0.060, 0.060]],
    [0.03, [1.30, 0.55, 0.22], [0.150, 0.230, 0.450], [0.950, 0.560, 0.300], [0.280, 0.290, 0.400], [0.150, 0.110, 0.085]],
    [0.18, [2.30, 1.45, 0.80], [0.170, 0.330, 0.640], [0.800, 0.700, 0.560], [0.360, 0.430, 0.580], [0.200, 0.170, 0.130]],
    [0.45, [2.70, 2.45, 2.05], [0.150, 0.360, 0.740], [0.560, 0.700, 0.860], [0.400, 0.520, 0.720], [0.230, 0.210, 0.170]],
    [1.0, [2.80, 2.65, 2.35], [0.130, 0.340, 0.740], [0.540, 0.700, 0.880], [0.420, 0.540, 0.740], [0.240, 0.220, 0.180]]
  ];

  // ---------- Nuanceurs ----------
  var COMMUN = [
    'float h21(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }',
    'float bruit(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }',
    // Courbe de pellicule : les ombres restent denses, les murs au soleil ne brûlent pas.
    'vec3 rendu(vec3 c) { c *= 0.58; c = clamp(c * (2.51 * c + 0.03) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0); return pow(c, vec3(0.4545)); }'
  ].join('\n');

  var VS = [
    '#version 300 es',
    'layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nor; layout(location = 2) in vec2 a_uv; layout(location = 3) in vec4 a_col; layout(location = 4) in float a_mat;',
    'uniform mat4 u_vp; uniform mat4 u_ombre;',
    'out vec3 v_pos; out vec3 v_nor; out vec2 v_uv; out vec3 v_col; flat out float v_graine; flat out int v_mat; out vec3 v_omb;',
    'void main() {',
    '  v_pos = a_pos; v_nor = a_nor; v_uv = a_uv; v_col = a_col.rgb * a_col.rgb; v_graine = floor(a_col.a * 255.0 + 0.5); v_mat = int(a_mat + 0.5);',
    '  v_omb = (u_ombre * vec4(a_pos + a_nor * 0.1, 1.0)).xyz * 0.5 + 0.5;',
    '  gl_Position = u_vp * vec4(a_pos, 1.0);',
    '}'
  ].join('\n');

  var FS = [
    '#version 300 es',
    'precision highp float; precision highp int; precision highp sampler2DShadow;',
    'in vec3 v_pos; in vec3 v_nor; in vec2 v_uv; in vec3 v_col; flat in float v_graine; flat in int v_mat; in vec3 v_omb;',
    'uniform vec3 u_oeil, u_soleil, u_coulSoleil, u_ciel, u_rebond, u_brume, u_brumeSoleil, u_herbe;',
    'uniform float u_densite, u_nuit, u_temps, u_neige, u_E, u_ombres, u_texel;',
    'uniform sampler2D u_sol, u_masque; uniform sampler2DShadow u_carte;',
    'out vec4 o_col;',
    COMMUN,
    // Appareil de pierre : assises de 42 cm, joints décalés d'un rang sur l'autre. p est en mètres sur le mur.
    'vec3 pierre(vec2 p, vec3 teinte, float flou) {',
    '  float r = floor(p.y / 0.42); vec2 q = vec2(p.x / 0.9 + 0.5 * mod(r, 2.0) + h21(vec2(r, 3.0)) * 0.4, p.y / 0.42);',
    '  vec2 f = fract(q); float id = h21(floor(q));',
    '  float joint = max(smoothstep(0.45, 0.5, abs(f.x - 0.5)) * 0.9, smoothstep(0.42, 0.5, abs(f.y - 0.5)));',
    '  vec3 c = teinte * (0.74 + 0.4 * id) * (0.86 + 0.28 * bruit(p * 2.3));',
    '  c = mix(c, teinte * 0.4, joint * 0.8);',
    '  return mix(c, teinte * 0.88 * (0.9 + 0.2 * bruit(p * 0.7)), max(flou, smoothstep(0.1, 0.4, max(fwidth(p.x), fwidth(p.y)))));',
    '}',
    'void main() {',
    '  vec3 N = normalize(v_nor), V = u_oeil - v_pos; float dist = length(V); V /= dist;',
    '  int m = v_mat;',
    '  if (m != 0 && m != 6 && m != 13 && dot(N, V) < 0.0) N = -N;',
    '  vec2 uvSol = v_pos.xz / (2.0 * u_E) + 0.5;',
    '  vec3 masque = texture(u_masque, uvSol).rgb;',
    '  vec3 alb = v_col, emis = vec3(0.0); float ao = 1.0, spec = 0.0, enveloppe = 0.0;',
    '  float flou = smoothstep(25.0, 90.0, dist), tresFlou = smoothstep(8.0, 40.0, dist);',
    // Coordonnées en mètres le long d'un mur, quelle que soit son orientation.
    '  vec2 pm = abs(N.y) > 0.7 ? v_pos.xz : vec2(dot(v_pos.xz, normalize(vec2(-N.z, N.x) + 1e-5)), v_pos.y);',
    '  if (m == 0) {',
    '    vec3 t = texture(u_sol, uvSol).rgb; t *= t;',
    '    float bord = smoothstep(0.94, 1.0, max(abs(v_pos.x), abs(v_pos.z)) / u_E);',
    '    t = mix(t, u_herbe, bord); float pave = masque.r * (1.0 - bord);',
    '    float g = bruit(v_pos.xz * 0.35) * 0.6 + bruit(v_pos.xz * 2.3) * 0.4;',
    '    vec3 nat = t * (0.66 + 0.6 * g) * (0.8 + 0.4 * bruit(v_pos.xz * vec2(9.0, 13.0)) * (1.0 - tresFlou)) * (0.9 + 0.2 * bruit(v_pos.xz * 0.07));',
    // Pavés : des galets en rangs décalés, chacun de sa nuance, le joint en creux.
    '    vec3 pv = t * 0.8;',
    '    if (pave > 0.01 && dist < 45.0) {',
    '      vec2 q = v_pos.xz * 5.6, qi = floor(q), qf = fract(q); float d1 = 9.0, d2 = 9.0, id = 0.0;',
    '      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {',
    '        vec2 o = vec2(float(i), float(j)); float hh = h21(qi + o); vec2 r = o + vec2(hh, fract(hh * 57.3)) * 0.8 + 0.1 - qf; float d = dot(r, r);',
    '        if (d < d1) { d2 = d1; d1 = d; id = hh; } else if (d < d2) d2 = d;',
    '      }',
    '      float joint = 1.0 - smoothstep(0.03, 0.2, sqrt(d2) - sqrt(d1));',
    '      pv = mix(t * (0.66 + 0.5 * fract(id * 13.7)) * (1.0 - 0.62 * joint), pv, smoothstep(0.1, 0.5, fwidth(q.x) + fwidth(q.y)));',
    '    }',
    '    pv *= 0.8 + 0.4 * g;',
    '    alb = mix(nat, pv, pave);',
    '  } else if (m == 1) {',
    // Colombages : u compte les travées, v les niveaux ; poteaux, sablières, écharpes, et une baie ou une porte par travée.
    '    float u = v_uv.x, v = v_uv.y; bool rue = u < 100.0;',
    '    vec2 f = fract(vec2(u, v)); vec2 c = floor(vec2(u, v));',
    '    int style = int(mod(v_graine, 4.0)); bool socle = mod(floor(v_graine / 4.0), 2.0) > 0.5;',
    '    float h = h21(c + v_graine * 0.37), h2 = h21(c * 1.7 + v_graine);',
    '    vec3 crepi = v_col * (0.8 + 0.2 * bruit(pm * 2.2)) * (0.78 + 0.3 * bruit(pm * 0.45 + v_graine)) * (0.92 + 0.1 * bruit(pm * 9.0) * (1.0 - tresFlou));',
    '    vec3 moellon = mix(v_col, vec3(0.36, 0.31, 0.25), 0.55);',
    '    vec3 bois = vec3(0.075, 0.048, 0.03) * (0.7 + 0.7 * h21(vec2(v_graine, 2.0))) * (0.8 + 0.4 * bruit(pm * vec2(3.0, 18.0)));',
    '    alb = crepi;',
    '    float poutre = 0.0;',
    '    if (style == 3) poutre = step(0.95, f.y) * step(1.0, v);',
    '    else if (style != 0) {',
    '      poutre = max(step(0.955, f.x) + step(f.x, 0.045), step(0.95, f.y) + step(f.y, 0.04));',
    '      if (v >= 1.0 || !socle) {',
    '        if (h < 0.22) poutre = max(poutre, step(abs(f.x - f.y), 0.045));',
    '        else if (h < 0.42) poutre = max(poutre, step(abs(f.x + f.y - 1.0), 0.045));',
    '        else if (h < 0.5) poutre = max(poutre, step(min(abs(f.x - f.y), abs(f.x + f.y - 1.0)), 0.038));',
    '        else if (style == 2) poutre = max(poutre, step(abs(f.x - 0.5), 0.035) * step(f.y, 0.3));',
    '      }',
    '      poutre = mix(min(poutre, 1.0), 0.2, smoothstep(0.05, 0.22, max(fwidth(u), fwidth(v))));',
    '    }',
    '    if (v < 1.0 && (socle || style == 0)) { alb = pierre(pm * 1.5, moellon * 0.9, flou); poutre = 0.0; }',
    '    else if (style == 0) alb = pierre(pm * 1.5, moellon * 1.15, flou);',
    '    alb = mix(alb, bois, poutre);',
    '    if (v >= 1.0 && h >= 0.5 && h2 > (rue ? 0.25 : 0.6)) {',
    '      vec2 w = abs(f - vec2(0.5, 0.55)) / vec2(0.23, 0.27);',
    '      float dans = step(max(w.x, w.y), 1.0);',
    '      if (dans > 0.5) {',
    '        float cadre = step(0.82, max(w.x, w.y)) + step(abs(f.x - 0.5), 0.018) + step(abs(f.y - 0.6), 0.014);',
    '        float allume = step(0.45, h21(c + v_graine * 1.3)) * u_nuit;',
    '        vec3 vitre = mix(vec3(0.03, 0.04, 0.055), vec3(0.10, 0.13, 0.16), f.y);',
    '        alb = mix(vitre, bois * 1.3, min(cadre, 1.0)); spec = cadre > 0.5 ? 0.0 : 0.5;',
    '        emis = (1.0 - min(cadre, 1.0)) * allume * vec3(1.0, 0.62, 0.26) * (0.9 + 1.2 * h2) * (0.75 + 0.25 * bruit(pm * 5.0));',
    '      }',
    '    } else if (v >= 0.0 && v < 1.0 && rue) {',
    '      float hp = h21(vec2(c.x, v_graine));',
    '      if (hp < 0.3) {',
    '        vec2 w = vec2(abs(f.x - 0.5) / 0.2, f.y / 0.7);',
    '        if (w.x < 1.0 && w.y < 1.0 - 0.12 * w.x * w.x) alb = vec3(0.10, 0.065, 0.04) * (0.7 + 0.5 * fract(pm.x * 5.0)) * (1.0 - 0.4 * step(0.92, w.x));',
    '      } else if (hp < 0.62) {',
    '        vec2 w = abs(f - vec2(0.5, 0.56)) / vec2(0.2, 0.17);',
    '        if (max(w.x, w.y) < 1.0) { float cadre = step(0.8, max(w.x, w.y)) + step(abs(f.x - 0.5), 0.02);',
    '          alb = mix(vec3(0.035, 0.04, 0.05), bois * 1.3, min(cadre, 1.0));',
    '          emis = (1.0 - min(cadre, 1.0)) * step(0.6, h21(c + v_graine)) * u_nuit * vec3(1.0, 0.58, 0.22) * 1.3; }',
    '      }',
    '    }',
    '    ao = mix(0.62, 1.0, smoothstep(0.0, 0.5, v));',
    '    alb *= mix(0.72, 1.0, smoothstep(-0.1, 0.35, v + 0.2 * bruit(pm * 1.3)));',
    '  } else if (m == 2) {',
    '    alb = pierre(pm, v_col, flou);',
    '    ao = abs(N.y) > 0.7 ? 1.0 : mix(0.72, 1.0, smoothstep(0.0, 1.6, v_pos.y));',
    '  } else if (m == 3) {',
    // Tuiles canal : des rangs qui se recouvrent, l'ombre du rang du dessus en haut de chaque tuile.
    '    float r = floor(v_uv.y / 0.34); vec2 q = vec2(v_uv.x / 0.23 + 0.5 * mod(r, 2.0), v_uv.y / 0.34); vec2 f = fract(q); float id = h21(floor(q));',
    '    float relief = (0.62 + 0.38 * sin(f.x * 3.1416)) * (0.66 + 0.4 * f.y);',
    '    alb = v_col * (0.7 + 0.6 * id) * mix(relief, 0.8, smoothstep(0.08, 0.4, fwidth(q.x) + fwidth(q.y))) * (0.8 + 0.4 * bruit(v_uv * 0.6));',
    '    alb = mix(alb, vec3(0.10, 0.12, 0.05), 0.35 * smoothstep(0.55, 0.9, bruit(v_pos.xz * 0.7 + v_graine)));',
    '  } else if (m == 4) {',
    '    float r = floor(v_uv.y / 0.26); vec2 q = vec2(v_uv.x / 0.3 + 0.5 * mod(r, 2.0), v_uv.y / 0.26); vec2 f = fract(q); float id = h21(floor(q));',
    '    float relief = (1.0 - 0.3 * step(f.y, 0.1)) * (1.0 - 0.25 * step(f.x, 0.06));',
    '    alb = v_col * (0.74 + 0.5 * id) * mix(relief, 0.9, smoothstep(0.08, 0.4, fwidth(q.x) + fwidth(q.y))) * (0.85 + 0.3 * bruit(v_uv * 0.8)); spec = 0.25;',
    '  } else if (m == 10) {',
    '    float fil = bruit(v_uv * vec2(16.0, 1.3)) * 0.5 + bruit(v_uv * vec2(4.0, 0.5)) * 0.5;',
    '    alb = v_col * (0.62 + 0.6 * fil) * (0.85 + 0.15 * sin(v_uv.y * 7.0));',
    '  } else if (m == 5) {',
    '    alb = v_col * (0.7 + 0.5 * bruit(pm * vec2(2.0, 22.0))) * (1.0 - 0.3 * step(0.93, fract(pm.x * 4.0)));',
    '  } else if (m == 6) {',
    '    alb = v_col * (0.8 + 0.45 * bruit(v_pos.xz * 1.9 + v_pos.y * 1.3)) * (0.9 + 0.2 * bruit(v_pos.xz * 7.0 + v_pos.y * 5.0) * (1.0 - tresFlou));',
    '    enveloppe = 0.45;',
    '  } else if (m == 13) {',
    '    alb = v_col * (0.75 + 0.4 * bruit(v_pos.xy * 6.0)); enveloppe = 0.2;',
    '  } else if (m == 7) {',
    '    vec2 o = v_pos.xz * 5.0; float t = u_temps * 1.6;',
    '    N = normalize(vec3(sin(o.x + t) * 0.08 + sin(o.y * 1.7 - t * 1.3) * 0.06, 1.0, cos(o.y + t * 0.8) * 0.08 + sin(o.x * 1.3 + t) * 0.05));',
    '    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);',
    '    alb = mix(v_col * 0.35, u_ciel * 0.6, 0.15 + 0.7 * fres); spec = 1.0;',
    '  } else if (m == 8) {',
    '    if (v_graine > 200.0) alb = v_col;',
    '    else { alb = vec3(0.30, 0.25, 0.16); emis = v_col * (0.15 + 4.0 * u_nuit); }',
    '  } else if (m == 9) {',
    // Pierre de taille percée de baies en lancette, une par travée et par niveau.
    '    alb = pierre(pm, v_col, flou);',
    '    vec2 f = fract(v_uv); vec2 c = floor(v_uv);',
    '    float haut = clamp((f.y - 0.68) / 0.14, 0.0, 1.0), demi = 0.15 * sqrt(1.0 - haut * haut);',
    '    if (v_uv.y >= 0.0 && f.y > 0.3 && f.y < 0.82 && abs(f.x - 0.5) < demi) {',
    '      float bordure = step(demi - 0.03, abs(f.x - 0.5)) + step(f.y, 0.33);',
    '      vec3 verre = v_graine > 1.5 && v_graine < 2.5 ? vec3(0.02) : mix(vec3(0.03, 0.04, 0.07), vec3(0.08, 0.10, 0.16), f.y);',
    '      alb = mix(verre, alb * 0.6, min(bordure, 1.0));',
    '      float vit = h21(c + floor(f.y * 9.0) * 0.31 + v_graine);',
    '      vec3 vitrail = v_graine < 1.5 ? mix(vec3(1.0, 0.5, 0.15), vec3(0.3, 0.5, 1.0), vit) : vec3(1.0, 0.62, 0.26);',
    '      emis = (1.0 - min(bordure, 1.0)) * u_nuit * vitrail * (v_graine > 1.5 && v_graine < 2.5 ? 0.0 : (v_graine < 1.5 ? 0.9 : step(0.5, h21(c + 3.0)) * 1.4));',
    '    }',
    '    ao = mix(0.72, 1.0, smoothstep(0.0, 1.6, v_pos.y));',
    '  } else if (m == 11) {',
    '    vec2 w = abs(v_uv - 0.5) * 2.0; float cadre = step(0.76, max(w.x, w.y)) + step(abs(v_uv.x - 0.5), 0.035) + step(abs(v_uv.y - 0.55), 0.03);',
    '    alb = mix(vec3(0.03, 0.04, 0.055), vec3(0.09, 0.06, 0.04), min(cadre, 1.0));',
    '    emis = (1.0 - min(cadre, 1.0)) * step(0.55, h21(vec2(v_graine, floor(v_pos.x)))) * u_nuit * vec3(1.0, 0.62, 0.26) * 1.6;',
    '  } else if (m == 12) {',
    '    o_col = vec4(mix(vec3(0.004), u_brume, 1.0 - exp(-dist * u_densite)), 1.0); o_col.rgb = rendu(o_col.rgb); return;',
    '  }',
    // La neige tient sur ce qui regarde le ciel.
    '  if (u_neige > 0.0 && m != 0 && m != 7 && m != 8) alb = mix(alb, vec3(0.60, 0.64, 0.71), u_neige * smoothstep(0.35, 0.75, N.y) * (0.55 + 0.45 * smoothstep(0.25, 0.6, bruit(v_pos.xz * 0.6) * 0.6 + bruit(v_pos.xz * 3.1) * 0.4)));',
    '  float nl = dot(N, u_soleil), diff = max(mix(nl, nl * 0.5 + 0.5, enveloppe), 0.0), ombre = 1.0;',
    // Ombre portée : quatre lectures filtrées autour du point, qui s'effacent au bord de la carte.
    '  if (u_ombres > 0.5 && diff > 0.0) {',
    '    vec3 s = v_omb; s.z -= 0.0009;',
    '    vec2 bordO = abs(s.xy - 0.5) * 2.0; float fond = smoothstep(0.82, 0.98, max(bordO.x, bordO.y));',
    '    if (fond < 1.0 && s.z < 1.0) {',
    '      float t = u_texel * 0.75;',
    '      ombre = (texture(u_carte, s + vec3(-t, -t, 0.0)) + texture(u_carte, s + vec3(t, -t, 0.0)) + texture(u_carte, s + vec3(-t, t, 0.0)) + texture(u_carte, s + vec3(t, t, 0.0))) * 0.25;',
    '      ombre = mix(ombre, 1.0, fond);',
    '    }',
    '  }',
    '  vec3 amb = mix(u_rebond, u_ciel, N.y * 0.5 + 0.5) * ao;',
    '  vec3 lum = u_coulSoleil * diff * ombre + amb;',
    // Les lanternes éclairent la rue : leur lueur est peinte sur une carte au sol et s'éteint avec la hauteur.
    '  lum += vec3(1.0, 0.55, 0.2) * masque.g * masque.g * u_nuit * 2.6 * exp(-max(v_pos.y, 0.0) / 4.0) * (0.55 + 0.45 * abs(N.y));',
    '  vec3 col = alb * lum + emis;',
    '  if (spec > 0.0) { vec3 H = normalize(u_soleil + V); col += u_coulSoleil * ombre * spec * pow(max(dot(N, H), 0.0), 60.0) * 0.6; }',
    '  float b = 1.0 - exp(-dist * u_densite);',
    '  col = mix(col, mix(u_brume, u_brumeSoleil, pow(max(dot(-V, u_soleil), 0.0), 6.0)), b);',
    '  o_col = vec4(rendu(col), 1.0);',
    '}'
  ].join('\n');

  var VS_OMBRE = '#version 300 es\nlayout(location = 0) in vec3 a_pos; uniform mat4 u_ombre; void main() { gl_Position = u_ombre * vec4(a_pos, 1.0); }';
  var FS_OMBRE = '#version 300 es\nprecision mediump float; void main() {}';

  var VS_CIEL = '#version 300 es\nout vec2 v_p; void main() { v_p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); gl_Position = vec4(v_p, 1.0, 1.0); }';
  var FS_CIEL = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 v_p; out vec4 o_col;',
    'uniform vec3 u_avant, u_droite, u_haut, u_soleil, u_astre, u_coulSoleil, u_zenith, u_horizon, u_brume;',
    'uniform float u_nuit, u_temps, u_nuages, u_jour;',
    COMMUN,
    'void main() {',
    '  vec3 d = normalize(u_avant + v_p.x * u_droite + v_p.y * u_haut);',
    '  float h = max(d.y, 0.0);',
    '  vec3 col = mix(u_horizon, u_zenith, pow(h, 0.42));',
    '  float s = max(dot(d, u_astre), 0.0);',
    // Le halo du soleil colore l'horizon de son côté ; le disque se dessine par-dessus.
    '  col += u_coulSoleil * (pow(s, 6.0) * 0.10 + pow(s, 60.0) * 0.22) * u_jour;',
    '  col += u_coulSoleil * smoothstep(0.99982, 0.9999, s) * 12.0 * u_jour;',
    '  col += vec3(0.85, 0.9, 1.0) * smoothstep(0.99986, 0.9999, s) * 2.2 * (1.0 - u_jour);',
    '  col += vec3(0.25, 0.3, 0.4) * pow(s, 400.0) * 0.5 * (1.0 - u_jour);',
    '  if (u_nuit > 0.0 && d.y > 0.0) {',
    '    vec3 q = d * 260.0; vec3 c = floor(q); float e = h21(c.xy + c.z * 17.3);',
    '    col += vec3(0.9, 0.95, 1.0) * step(0.9975, e) * (1.0 - smoothstep(0.1, 0.45, length(fract(q) - 0.5))) * u_nuit * smoothstep(0.0, 0.15, d.y) * (0.5 + e * 0.5);',
    '  }',
    '  if (u_nuages > 0.5 && d.y > 0.01) {',
    '    vec2 p = d.xz / (d.y + 0.16) * 1.1 + vec2(u_temps * 0.004, u_temps * 0.0015);',
    '    float n = bruit(p) * 0.5 + bruit(p * 2.1 + 3.0) * 0.27 + bruit(p * 4.3 + 7.0) * 0.15 + bruit(p * 9.0) * 0.08;',
    '    float c = smoothstep(0.52, 0.78, n) * smoothstep(0.01, 0.16, d.y);',
    '    vec3 clair = u_horizon * 0.7 + u_coulSoleil * (0.22 + 0.25 * pow(s, 4.0)) + u_zenith * 0.25;',
    '    col = mix(col, mix(clair, u_zenith * 0.5 + u_horizon * 0.2, smoothstep(0.6, 0.95, n) * 0.6), c * 0.85);',
    '  }',
    '  col = mix(col, u_brume, smoothstep(0.06, -0.02, d.y));',
    '  o_col = vec4(rendu(col), 1.0);',
    '}'
  ].join('\n');

  // ---------- Matrices ----------
  function fois(a, b, o) {
    var i, j;
    for (j = 0; j < 4; j++) for (i = 0; i < 4; i++) o[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
    return o;
  }
  function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  // L'état du ciel à une heure donnée (0 à 24) : où sont le soleil et la lune, et de quelles couleurs.
  function ciel(heure) {
    var a = (heure - 6) / 12 * Math.PI, el = Math.sin(a) * 1.05, az = a, s, i, k, A, B, t, lune, jour, o = {};
    s = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az) * 0.9 + 0.25 * Math.cos(el)];
    t = Math.sqrt(s[0] * s[0] + s[1] * s[1] + s[2] * s[2]); s = [s[0] / t, s[1] / t, s[2] / t];
    lune = [-s[0] * 0.8 + 0.2, Math.max(0.25, -s[1] * 0.9 + 0.2), -s[2] * 0.8 - 0.3];
    t = Math.sqrt(lune[0] * lune[0] + lune[1] * lune[1] + lune[2] * lune[2]); lune = [lune[0] / t, lune[1] / t, lune[2] / t];
    for (i = 0; i < CIELS.length - 2 && s[1] > CIELS[i + 1][0]; i++);
    A = CIELS[i]; B = CIELS[i + 1]; k = Math.max(0, Math.min(1, (s[1] - A[0]) / (B[0] - A[0])));
    jour = s[1] > -0.06;
    o.soleil = s; o.astre = jour ? s : lune; o.jour = jour ? 1 : 0;
    // Près de l'horizon le soleil rasant n'éclaire plus guère : on allonge les ombres sans les laisser tourner à l'infini.
    o.lumiere = jour ? [s[0], Math.max(s[1], 0.09), s[2]] : lune;
    t = Math.sqrt(o.lumiere[0] * o.lumiere[0] + o.lumiere[1] * o.lumiere[1] + o.lumiere[2] * o.lumiere[2]);
    o.lumiere = [o.lumiere[0] / t, o.lumiere[1] / t, o.lumiere[2] / t];
    o.coulSoleil = lerp3(A[1], B[1], k); o.zenith = lerp3(A[2], B[2], k); o.horizon = lerp3(A[3], B[3], k); o.ciel = lerp3(A[4], B[4], k); o.rebond = lerp3(A[5], B[5], k);
    o.nuit = Math.max(0, Math.min(1, (0.07 - s[1]) / 0.2));
    o.hauteur = s[1];
    return o;
  }

  // ---------- Sol peint ----------
  // Deux toiles : la couleur du sol (ville, champs et sillons, routes, ombre au pied des murs) et un masque (rouge : pavé ; vert : lueur des lanternes).
  function peindre(monde) {
    var S = monde.sol, E = monde.E, c = document.createElement('canvas'), mq = document.createElement('canvas'), x = c.getContext('2d'), y = mq.getContext('2d'), k = TAILLE_SOL / (2 * E), km = TAILLE_MASQUE / (2 * E);
    c.width = c.height = TAILLE_SOL; mq.width = mq.height = TAILLE_MASQUE;
    function rgb(v, f) { f = f || 1; return 'rgb(' + Math.round(Math.min(255, v[0] * f)) + ',' + Math.round(Math.min(255, v[1] * f)) + ',' + Math.round(Math.min(255, v[2] * f)) + ')'; }
    function trace(ctx, poly, ferme) {
      ctx.beginPath();
      poly.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      if (ferme !== false) ctx.closePath();
    }
    function plein(ctx, poly, style) { trace(ctx, poly); ctx.fillStyle = style; ctx.fill(); }
    function ligne(ctx, pts, style, large) { trace(ctx, pts, false); ctx.strokeStyle = style; ctx.lineWidth = large; ctx.lineJoin = ctx.lineCap = 'round'; ctx.stroke(); }

    x.fillStyle = rgb(S.herbe); x.fillRect(0, 0, TAILLE_SOL, TAILLE_SOL);
    y.fillStyle = '#000'; y.fillRect(0, 0, TAILLE_MASQUE, TAILLE_MASQUE);
    x.setTransform(k, 0, 0, k, TAILLE_SOL / 2, TAILLE_SOL / 2);
    y.setTransform(km, 0, 0, km, TAILLE_MASQUE / 2, TAILLE_MASQUE / 2);

    S.bois.forEach(function (p) { plein(x, p, rgb(S.sousBois)); });
    S.champs.forEach(function (f) {
      var lo = Infinity, hi = -Infinity, o, nx = -f.uy, ny = f.ux, cx = 0, cy = 0;
      plein(x, f.poly, rgb(f.c));
      x.save(); trace(x, f.poly); x.clip();
      f.poly.forEach(function (p) { var d = p.x * nx + p.y * ny; lo = Math.min(lo, d); hi = Math.max(hi, d); cx += p.x / f.poly.length; cy += p.y / f.poly.length; });
      x.strokeStyle = 'rgba(40,28,12,.22)'; x.lineWidth = 0.9; x.beginPath();
      for (o = lo + 1; o < hi; o += 2.4) {
        x.moveTo(cx + nx * (o - cx * nx - cy * ny) - f.ux * 400, cy + ny * (o - cx * nx - cy * ny) - f.uy * 400);
        x.lineTo(cx + nx * (o - cx * nx - cy * ny) + f.ux * 400, cy + ny * (o - cx * nx - cy * ny) + f.uy * 400);
      }
      x.stroke(); x.restore();
      ligne(x, f.poly.concat([f.poly[0]]), 'rgba(50,60,30,.35)', 1.4);
    });
    S.routes.forEach(function (r) {
      ligne(x, r, rgb(S.terre, 0.8), S.largeurRoute * 2 + 1.5);
      ligne(x, r, rgb(S.terre, 1.08), S.largeurRoute * 2 - 0.5);
      ligne(x, r, rgb(S.terre, 0.95), 1.2);
    });
    // Un liseré de terre battue autour des murs, puis la ville.
    ligne(x, S.ville.concat([S.ville[0]]), rgb(S.terre, 0.92), 14);
    plein(x, S.ville, 'rgb(134,120,100)'); plein(y, S.ville, '#f00');
    S.ilots.forEach(function (p) { plein(x, p, 'rgb(112,100,84)'); });
    if (S.chateau) { plein(x, S.chateau, 'rgb(140,130,112)'); plein(y, S.chateau, '#900'); }
    S.jardins.forEach(function (p) { plein(x, p, rgb(S.neige ? S.herbe : [96, 128, 62])); plein(y, p, '#000'); });
    S.avenues.forEach(function (r) { ligne(x, r, 'rgb(146,134,116)', S.largeurRoute * 2 - 1.2); });
    if (S.place) plein(x, S.place, 'rgb(152,141,122)');
    if (S.fontaine) { x.beginPath(); x.arc(S.fontaine.x, S.fontaine.y, 5.4, 0, 6.3); x.fillStyle = 'rgb(165,158,146)'; x.fill(); }
    // L'ombre au pied des murs : trois traits de plus en plus étroits font un dégradé.
    [[5, 0.10], [2.6, 0.13], [1, 0.16]].forEach(function (t) {
      x.strokeStyle = 'rgba(18,14,10,' + t[1] + ')'; x.lineWidth = t[0]; x.lineJoin = 'round';
      x.beginPath();
      S.empreintes.forEach(function (poly) { poly.forEach(function (p, i) { if (i) x.lineTo(p.x, p.y); else x.moveTo(p.x, p.y); }); x.closePath(); });
      x.stroke();
    });
    y.globalCompositeOperation = 'lighter';
    S.lanternes.forEach(function (l) {
      var g = y.createRadialGradient(l.x, l.y, 0, l.x, l.y, 12);
      g.addColorStop(0, 'rgba(0,255,0,.85)'); g.addColorStop(0.35, 'rgba(0,255,0,.35)'); g.addColorStop(1, 'rgba(0,255,0,0)');
      y.fillStyle = g; y.fillRect(l.x - 12, l.y - 12, 24, 24);
    });
    return { sol: c, masque: mq };
  }

  // ---------- Rendu ----------
  function creer(canvas) {
    var gl = null, R = {}, prog, progOmbre, progCiel, U = {}, UO = {}, UC = {}, vao, blocs = [], monde = null, texSol, texMasque, fbo = null, carte = null, tailleCarte = 0;
    var pixel = new Uint8Array(4), proches = [], P = new Float32Array(16), Vm = new Float32Array(16), VP = new Float32Array(16), MO = new Float32Array(16), plans = new Float32Array(24), ident = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    try { gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false }); } catch (e) { gl = null; }
    if (!gl) return null;

    function nuanceur(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Nuanceur : ' + gl.getShaderInfoLog(s));
      return s;
    }
    function programme(vs, fs, noms, dans) {
      var p = gl.createProgram();
      gl.attachShader(p, nuanceur(gl.VERTEX_SHADER, vs)); gl.attachShader(p, nuanceur(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Programme : ' + gl.getProgramInfoLog(p));
      noms.forEach(function (n) { dans[n] = gl.getUniformLocation(p, 'u_' + n); });
      return p;
    }
    try {
      prog = programme(VS, FS, ['vp', 'ombre', 'oeil', 'soleil', 'coulSoleil', 'ciel', 'rebond', 'brume', 'brumeSoleil', 'herbe', 'densite', 'nuit', 'temps', 'neige', 'E', 'ombres', 'texel', 'sol', 'masque', 'carte'], U);
      progOmbre = programme(VS_OMBRE, FS_OMBRE, ['ombre'], UO);
      progCiel = programme(VS_CIEL, FS_CIEL, ['avant', 'droite', 'haut', 'soleil', 'astre', 'coulSoleil', 'zenith', 'horizon', 'brume', 'nuit', 'temps', 'nuages', 'jour'], UC);
    } catch (e) { R.panne = e.message; return R; }

    function texture(source) {
      var t = gl.createTexture(), ext = gl.getExtension('EXT_texture_filter_anisotropic');
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      return t;
    }

    R.charge = function (m) {
      var vbo = gl.createBuffer(), ibo = gl.createBuffer(), o = m.octets, p;
      monde = m;
      vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, m.sommets, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, o, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.BYTE, true, o, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, o, 16);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, o, 24);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.UNSIGNED_BYTE, false, o, 15);
      gl.bindVertexArray(null);
      blocs = m.blocs.map(function (b) {
        var c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
        return { couche: b.couche, debut: b.debut, nombre: b.nombre, min: b.min, max: b.max, c: c, r: Math.sqrt(Math.pow(b.max[0] - c[0], 2) + Math.pow(b.max[1] - c[1], 2) + Math.pow(b.max[2] - c[2], 2)) };
      });
      p = peindre(m);
      texSol = texture(p.sol); texMasque = texture(p.masque);
    };

    function carteOmbre(taille) {
      if (taille === tailleCarte) return;
      if (carte) { gl.deleteTexture(carte); gl.deleteFramebuffer(fbo); carte = fbo = null; }
      tailleCarte = taille;
      if (!taille) return;
      carte = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, carte);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, taille, taille);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, carte, 0);
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // Dessine les blocs retenus ; ceux qui se suivent dans le tampon partent d'un seul appel.
    function tire(garde, stats) {
      var i, b, de = -1, nb = 0;
      for (i = 0; i <= blocs.length; i++) {
        b = blocs[i];
        if (b && garde(b)) {
          if (de >= 0 && de + nb === b.debut) { nb += b.nombre; continue; }
          if (de >= 0) { gl.drawElements(gl.TRIANGLES, nb, gl.UNSIGNED_INT, de * 4); stats.appels++; stats.triangles += nb / 3; }
          de = b.debut; nb = b.nombre;
        } else if (de >= 0 && (!b || b.nombre)) {
          gl.drawElements(gl.TRIANGLES, nb, gl.UNSIGNED_INT, de * 4); stats.appels++; stats.triangles += nb / 3;
          de = -1; nb = 0;
        }
      }
    }
    function dansChamp(b) {
      var k, o;
      for (k = 0; k < 6; k++) {
        o = k * 4;
        if (plans[o] * (plans[o] > 0 ? b.max[0] : b.min[0]) + plans[o + 1] * (plans[o + 1] > 0 ? b.max[1] : b.min[1]) + plans[o + 2] * (plans[o + 2] > 0 ? b.max[2] : b.min[2]) + plans[o + 3] < 0) return false;
      }
      return true;
    }

    // cam : { x, y (hauteur), z, cap, tangage, champ (radians) } ; env : { heure, temps } ; q : un réglage de QUALITES.
    R.dessine = function (cam, env, q) {
      var w = canvas.width, h = canvas.height, f = 1 / Math.tan(cam.champ / 2), asp = w / h, cc = Math.cos(cam.tangage), sc = Math.sin(cam.tangage);
      var av = [Math.cos(cam.cap) * cc, sc, Math.sin(cam.cap) * cc], dr = [-Math.sin(cam.cap), 0, Math.cos(cam.cap)], ht = [dr[1] * av[2] - dr[2] * av[1], dr[2] * av[0] - dr[0] * av[2], dr[0] * av[1] - dr[1] * av[0]];
      var C = ciel(env.heure), L = C.lumiere, stats = { appels: 0, triangles: 0, appelsOmbre: 0, trianglesOmbre: 0 }, so = { appels: 0, triangles: 0 }, i, k, l, b, d, rayon, lx, ly, cx, cy, cz, tx, ty, pas, ex, ez, dens, brume, brumeS, ombres;
      if (!monde) return stats;

      P.fill(0); P[0] = f / asp; P[5] = f; P[10] = (LOIN + PRES) / (PRES - LOIN); P[11] = -1; P[14] = 2 * LOIN * PRES / (PRES - LOIN);
      Vm[0] = dr[0]; Vm[4] = dr[1]; Vm[8] = dr[2]; Vm[12] = -(dr[0] * cam.x + dr[1] * cam.y + dr[2] * cam.z);
      Vm[1] = ht[0]; Vm[5] = ht[1]; Vm[9] = ht[2]; Vm[13] = -(ht[0] * cam.x + ht[1] * cam.y + ht[2] * cam.z);
      Vm[2] = -av[0]; Vm[6] = -av[1]; Vm[10] = -av[2]; Vm[14] = av[0] * cam.x + av[1] * cam.y + av[2] * cam.z;
      Vm[3] = Vm[7] = Vm[11] = 0; Vm[15] = 1;
      fois(P, Vm, VP);
      // Les six plans du champ, tirés des lignes de la matrice.
      for (k = 0; k < 6; k++) {
        for (i = 0; i < 4; i++) plans[k * 4 + i] = VP[i * 4 + 3] + (k % 2 ? -1 : 1) * VP[i * 4 + (k >> 1)];
        l = Math.sqrt(plans[k * 4] * plans[k * 4] + plans[k * 4 + 1] * plans[k * 4 + 1] + plans[k * 4 + 2] * plans[k * 4 + 2]) || 1;
        for (i = 0; i < 4; i++) plans[k * 4 + i] /= l;
      }

      // ---------- Carte d'ombre ----------
      ombres = q.ombre > 0 && (C.coulSoleil[0] + C.coulSoleil[1] + C.coulSoleil[2]) > 0.02;
      carteOmbre(q.ombre);
      gl.bindVertexArray(vao);
      gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      if (ombres) {
        // Le volume d'ombre est centré un peu devant le marcheur et grandit quand on s'élève. Son centre saute de texel en texel,
        // sans quoi le bord des ombres frémirait à chaque pas.
        rayon = Math.max(q.rayon, (cam.y - 2) * 1.5);
        l = Math.sqrt(L[0] * L[0] + L[2] * L[2]) || 1;
        lx = [L[2] / l, 0, -L[0] / l]; ly = [L[1] * lx[2] - L[2] * lx[1], L[2] * lx[0] - L[0] * lx[2], L[0] * lx[1] - L[1] * lx[0]];
        ex = cam.x + Math.cos(cam.cap) * rayon * 0.55; ez = cam.z + Math.sin(cam.cap) * rayon * 0.55;
        pas = 2 * rayon / q.ombre;
        cx = Math.round((ex * lx[0] + ez * lx[2]) / pas) * pas; cy = Math.round((ex * ly[0] + ez * ly[2]) / pas) * pas; cz = ex * L[0] + ez * L[2];
        MO.fill(0);
        MO[0] = lx[0] / rayon; MO[4] = lx[1] / rayon; MO[8] = lx[2] / rayon; MO[12] = -cx / rayon;
        MO[1] = ly[0] / rayon; MO[5] = ly[1] / rayon; MO[9] = ly[2] / rayon; MO[13] = -cy / rayon;
        MO[2] = -L[0] / PROF_OMBRE; MO[6] = -L[1] / PROF_OMBRE; MO[10] = -L[2] / PROF_OMBRE; MO[14] = cz / PROF_OMBRE;
        MO[15] = 1;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, q.ombre, q.ombre);
        gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.colorMask(false, false, false, false);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2.2, 4);
        gl.useProgram(progOmbre); gl.uniformMatrix4fv(UO.ombre, false, MO);
        tire(function (b) {
          if (b.couche === COUCHE.SOL) return false;
          tx = b.c[0] * lx[0] + b.c[1] * lx[1] + b.c[2] * lx[2] - cx; ty = b.c[0] * ly[0] + b.c[1] * ly[1] + b.c[2] * ly[2] - cy;
          return Math.abs(tx) < rayon + b.r && Math.abs(ty) < rayon + b.r;
        }, so);
        stats.appelsOmbre = so.appels; stats.trianglesOmbre = so.triangles;
        gl.disable(gl.POLYGON_OFFSET_FILL); gl.colorMask(true, true, true, true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }

      // ---------- Ville ----------
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // La brume du matin et du soir est plus épaisse ; elle prend la couleur de l'horizon.
      dens = (0.00045 + 0.0011 * Math.max(0, 1 - Math.abs(C.hauteur - 0.1) / 0.3)) * (monde.neige ? 1.6 : 1);
      brume = lerp3(C.horizon, C.zenith, 0.22);
      brumeS = [brume[0] + C.coulSoleil[0] * 0.16 * C.jour, brume[1] + C.coulSoleil[1] * 0.16 * C.jour, brume[2] + C.coulSoleil[2] * 0.16 * C.jour];
      gl.useProgram(prog);
      gl.uniformMatrix4fv(U.vp, false, VP); gl.uniformMatrix4fv(U.ombre, false, ombres ? MO : ident);
      gl.uniform3f(U.oeil, cam.x, cam.y, cam.z); gl.uniform3fv(U.soleil, L); gl.uniform3fv(U.coulSoleil, C.coulSoleil);
      gl.uniform3fv(U.ciel, C.ciel); gl.uniform3fv(U.rebond, C.rebond); gl.uniform3fv(U.brume, brume); gl.uniform3fv(U.brumeSoleil, brumeS);
      gl.uniform3f(U.herbe, Math.pow(monde.sol.herbe[0] / 255, 2), Math.pow(monde.sol.herbe[1] / 255, 2), Math.pow(monde.sol.herbe[2] / 255, 2));
      gl.uniform1f(U.densite, dens); gl.uniform1f(U.nuit, C.nuit); gl.uniform1f(U.temps, env.temps); gl.uniform1f(U.neige, monde.neige ? 1 : 0);
      gl.uniform1f(U.E, monde.E); gl.uniform1f(U.ombres, ombres ? 1 : 0); gl.uniform1f(U.texel, q.ombre ? 1 / q.ombre : 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texSol); gl.uniform1i(U.sol, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texMasque); gl.uniform1i(U.masque, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, carte); gl.uniform1i(U.carte, 2);
      // Ce qui est près part d'abord, du plus proche au plus lointain, et le sol en dernier : le tampon de profondeur épargne
      // ainsi le calcul des matières à tout ce qu'une façade cache.
      proches.length = 0;
      for (i = 0; i < blocs.length; i++) {
        b = blocs[i]; b.vu = 0;
        if (!dansChamp(b)) continue;
        d = Math.sqrt((b.c[0] - cam.x) * (b.c[0] - cam.x) + (b.c[1] - cam.y) * (b.c[1] - cam.y) + (b.c[2] - cam.z) * (b.c[2] - cam.z)) - b.r;
        if (b.couche === COUCHE.SOL) b.vu = 3;
        else if (b.couche !== COUCHE.MURS && d > (b.couche === COUCHE.ARBRES ? q.arbres : q.vue)) continue;
        else if (d < PROCHE) { b.vu = 1; b.d = d; proches.push(b); } else b.vu = 2;
      }
      proches.sort(function (p, o) { return p.d - o.d; });
      for (i = 0; i < proches.length; i++) { gl.drawElements(gl.TRIANGLES, proches[i].nombre, gl.UNSIGNED_INT, proches[i].debut * 4); stats.appels++; stats.triangles += proches[i].nombre / 3; }
      tire(function (b) { return b.vu === 2; }, stats);
      tire(function (b) { return b.vu === 3; }, stats);

      // ---------- Ciel ----------
      gl.useProgram(progCiel);
      k = Math.tan(cam.champ / 2);
      gl.uniform3fv(UC.avant, av); gl.uniform3f(UC.droite, dr[0] * k * asp, dr[1] * k * asp, dr[2] * k * asp); gl.uniform3f(UC.haut, ht[0] * k, ht[1] * k, ht[2] * k);
      gl.uniform3fv(UC.soleil, C.soleil); gl.uniform3fv(UC.astre, C.astre); gl.uniform3fv(UC.coulSoleil, C.coulSoleil); gl.uniform3fv(UC.zenith, C.zenith); gl.uniform3fv(UC.horizon, C.horizon); gl.uniform3fv(UC.brume, brume);
      gl.uniform1f(UC.nuit, C.nuit); gl.uniform1f(UC.temps, env.temps); gl.uniform1f(UC.nuages, q.nuages); gl.uniform1f(UC.jour, C.jour);
      gl.drawArrays(gl.TRIANGLES, 0, 3); stats.appels++;
      gl.bindVertexArray(null);
      return stats;
    };

    R.taille = function (w, h) { if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } };
    R.erreur = function () { return gl.getError(); };
    // Lire un pixel oblige la carte à finir l'image : c'est ce qui permet de la chronométrer.
    R.attend = function () { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); };
    R.perdu = function () { return gl.isContextLost(); };
    R.materiel = function () {
      var e = gl.getExtension('WEBGL_debug_renderer_info');
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    };
    R.gl = gl;
    return R;
  }

  window.VisiteRendu = { QUALITES: QUALITES, creer: creer, ciel: ciel, peindre: peindre };
})();
