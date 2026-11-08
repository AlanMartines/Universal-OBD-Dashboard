#!/usr/bin/env python3
"""Modelo 3D aproximado da placa ilhada da escuta CAN (Uno Vivace), feito a partir das posições de gerar_placa.py.

Gera, na mesma pasta:
- modelo3d-dados.js: peças para o visor modelo3d.html (WebGL próprio em visor3d.js, sem bibliotecas externas);
- modelo3d.scad: o mesmo modelo para o OpenSCAD (F5 para ver, variáveis no topo para esconder partes);
- cópia de modelo3d-dados.js em server/web/src/modules/projeto/public: o painel (/projeto/placa) monta o modelo\n  detalhado com Three.js (placa3d.mjs) a partir das posições em 'detalhe'.

As posições na placa vêm de gerar_placa.py. As alturas são estimativas (barras de pinos e componentes comuns),
não medidas: servem para ver o encaixe, não para projetar caixa com folga justa.

    python3 veiculos/fiat-uno-vivace-2012/placa/gerar_3d.py
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gerar_placa as g  # noqa: E402

OUT = g.OUT
# O painel web publica o mesmo modelo em /projeto/placa: a imagem Docker só enxerga server/web, então vai uma cópia.
WEB = os.path.normpath(os.path.join(OUT, '../../../server/web/src/modules/projeto/public'))
P = g.P
hp = g.hp

# ---------------------------------------------------------------- Alturas (mm, estimadas)
T = 1.6                     # placa perfurada
FEM_H = 8.5                 # barra fêmea do ESP32
MALE_H = 2.5                # plástico da barra de pinos macho
ESP_Z = T + FEM_H + MALE_H  # fundo da placa do ESP32
MOD_Z = T + MALE_H          # fundo do TJA1050 e do RT8272
MOD_T = 1.6                 # placa dos módulos
WIRE_Z = T + 0.6            # fios isolados por cima
BOT_Z = -0.4                # fio estanhado por baixo
FUSE_H = 7.37               # suporte Keystone 3568 (catálogo)

GOLD, SILVER, TIN = '#d4af37', '#c0c0c0', '#b0b7bd'

parts = []   # [camada, tipo, cor, ...] em coordenadas da placa: x para a direita, y para baixo, z para cima


def r3(v):
    return [round(float(a), 3) for a in v]


def box(layer, col, x0, y0, z0, sx, sy, sz):
    parts.append([layer, 'box', col, r3((x0 + sx / 2, y0 + sy / 2, z0 + sz / 2)), r3((sx, sy, sz))])


def cyl(layer, col, a, b, r):
    parts.append([layer, 'cyl', col, r3(a), r3(b), round(r, 3)])


def ball(layer, col, c, r):
    parts.append([layer, 'ball', col, r3(c), round(r, 3)])


def tube(layer, col, pts, r):
    for a, b in zip(pts, pts[1:]):
        cyl(layer, col, a, b, r)
    for p in pts[1:-1]:
        ball(layer, col, p, r)


def xy(c, r):
    return hp(c, r)


def is_hole(c, r):
    return float(c).is_integer() and float(r).is_integer()


# ---------------------------------------------------------------- Placa, barras fêmea e resistores
box('placa', '#efe3c2', 0, 0, 0, g.W, g.H, T)
for row in (2, 12):
    x1, y = xy(2, row)
    box('placa', '#212121', x1 - P / 2, y - P / 2, T, 15 * P, P, FEM_H)

BANDS = ['#6d4c41', '#212121', '#d32f2f', '#c9a227']   # 1 kΩ: marrom, preto, vermelho, ouro
for name, a, b, _ in g.RES:
    (x1, y1), (x2, y2) = xy(*a), xy(*b)
    L = math.hypot(x2 - x1, y2 - y1)
    ux, uy = (x2 - x1) / L, (y2 - y1) / L
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    zc = T + 1.25
    cyl('placa', '#e8d3a9', (mx - ux * 3.1, my - uy * 3.1, zc), (mx + ux * 3.1, my + uy * 3.1, zc), 1.15)
    for i, col in enumerate(BANDS):
        off = -1.9 + i * 1.1 + (0.6 if i == 3 else 0)
        cyl('placa', col, (mx + ux * (off - 0.3), my + uy * (off - 0.3), zc), (mx + ux * (off + 0.3), my + uy * (off + 0.3), zc), 1.2)
    for (hx, hy), s in (((x1, y1), -1), ((x2, y2), 1)):
        end = (mx + ux * 3.1 * s, my + uy * 3.1 * s, zc)
        tube('placa', SILVER, [(hx, hy, -0.8), (hx, hy, zc), end], 0.3)

# ---------------------------------------------------------------- ESP32 DevKit V1
cx = (xy(2, 2)[0] + xy(16, 2)[0]) / 2
cy = (xy(2, 2)[1] + xy(2, 12)[1]) / 2
x0, y0 = cx - g.ESP_L / 2, cy - g.ESP_W / 2
for row in (2, 12):
    x1, y = xy(2, row)
    box('esp32', '#111111', x1 - P / 2, y - P / 2, T + FEM_H, 15 * P, P, MALE_H)
box('esp32', '#1a237e', x0, y0, ESP_Z, g.ESP_L, g.ESP_W, 1.6)
top = ESP_Z + 1.6
box('esp32', '#263238', x0 + 1.0, cy - 9, top, 25.5, 18, 0.8)
box('esp32', '#b0bec5', x0 + 7.5, cy - 8, top + 0.8, 18, 16, 2.4)
zig = [(x0 + 2.0 + (i % 2) * 3.5, cy - 7 + i * 1.4, top + 0.85) for i in range(11)]   # antena impressa
tube('esp32', '#c9a227', zig, 0.2)
box('esp32', '#cfd8dc', x0 + 44.5, cy - 3.8, top, 6.5, 7.6, 3.0)
for by in (cy - 9.5, cy + 8.2):
    box('esp32', '#eeeeee', x0 + 40, by, top, 3.4, 2.4, 1.2)
    cyl('esp32', '#424242', (x0 + 41.7, by + 1.2, top + 1.2), (x0 + 41.7, by + 1.2, top + 1.7), 0.7)
for row in (2, 12):
    for c in range(2, 17):
        x, y = xy(c, row)
        cyl('esp32', GOLD, (x, y, T + FEM_H - 1.0), (x, y, top + 0.8), 0.32)

# ---------------------------------------------------------------- TJA1050 (22 x 11 mm, barra de 4 pinos)
vx, vy = xy(*g.TJA_PINS['VCC'])
_, gy = xy(*g.TJA_PINS['GND'])
box('modulos', '#111111', vx - P / 2, vy - P / 2, T, P, 4 * P, MALE_H)
for c, r in g.TJA_PINS.values():
    x, y = xy(c, r)
    cyl('modulos', GOLD, (x, y, -1.0), (x, y, MOD_Z + MOD_T + 0.6), 0.32)
tx0 = vx - 1.2
yc = (vy + gy) / 2
ty0 = yc - g.TJA_MM[1] / 2
box('modulos', '#1565c0', tx0, ty0, MOD_Z, g.TJA_MM[0], g.TJA_MM[1], MOD_T)
mt = MOD_Z + MOD_T
box('modulos', '#212121', tx0 + 5.0, yc - 2.6, mt, 5.6, 5.2, 1.5)
box('modulos', '#212121', tx0 + 12.4, ty0 + 1.0, mt, 2.4, 1.4, 0.5)
for dy in (1.8, g.TJA_MM[1] - 1.8):
    cyl('modulos', '#e3f2fd', (tx0 + g.TJA_MM[0] - 2.9, ty0 + dy, mt), (tx0 + g.TJA_MM[0] - 2.9, ty0 + dy, mt + 0.05), 1.1)
for n, (c, r) in g.TJA_CAN.items():   # CANH e CANL: perna curta do pino até a ilha da coluna 18
    x, y = xy(c, r)
    hx, hy = xy(*g.CAN_HOLES[n])
    tube('modulos', SILVER, [(x, y, mt + 0.6), (x, y, T + 1.4), (hx, hy, T), (hx, hy, -0.8)], 0.3)

# ---------------------------------------------------------------- RT8272 (HW-108, 21 x 21 mm)
ex, ey = xy(*g.BUCK_PINS['EN'])
ox, oy = xy(*g.BUCK_PINS['OUT-'])
box('modulos', '#111111', ex - P / 2, ey - P / 2, T, P, 3 * P, MALE_H)
box('modulos', '#111111', ox - P / 2, oy - P / 2, T, P, 2 * P, MALE_H)
for c, r in g.BUCK_PINS.values():
    x, y = xy(c, r)
    cyl('modulos', GOLD, (x, y, -1.0), (x, y, MOD_Z + MOD_T + 0.6), 0.32)
bx0, by0 = ox - 1.5, ey - 1.2
box('modulos', '#0d47a1', bx0, by0, MOD_Z, g.BUCK_MM, g.BUCK_MM, MOD_T)
bt = MOD_Z + MOD_T
box('modulos', '#212121', bx0 + 10.5, by0 + 9.5, bt, 9, 9, 4.0)
cyl('modulos', '#424242', (bx0 + 15, by0 + 14, bt + 4.0), (bx0 + 15, by0 + 14, bt + 4.05), 3.6)
box('modulos', '#212121', bx0 + 5.5, by0 + 2.0, bt, 6, 5, 1.2)
box('modulos', '#cfd8dc', bx0 + 0.8, by0 + 0.8, bt, 3.4, 3.4, 2.2)
cyl('modulos', '#78909c', (bx0 + 2.5, by0 + 2.5, bt + 2.2), (bx0 + 2.5, by0 + 2.5, bt + 2.6), 0.9)

# ---------------------------------------------------------------- Suporte do fusível com o fusível mini de 1 A
fcx, fcy = xy(*g.FUSE_C)
fw, fd = g.FUSE_MM
box('fusivel', '#37474f', fcx - fw / 2, fcy - fd / 2, T, fw, fd, FUSE_H)
box('fusivel', '#111111', fcx - 5.45, fcy - 1.9, T + 4.0, 10.9, 3.8, 10.0)
box('fusivel', '#eeeeee', fcx - 1.0, fcy - 1.95, T + 11.0, 2.0, 0.1, 2.6)   # "1" impresso no fusível
for pins in g.FUSE_PINS.values():
    for c, r in pins:
        x, y = xy(c, r)
        cyl('fusivel', SILVER, (x, y, -1.0), (x, y, T + 0.5), 0.78)

# ---------------------------------------------------------------- Fios isolados por cima (J1 a J3, CANL, cabo OBD)
for name, col, pts, _ in g.JUMPERS:
    (c0, r0), (c1, r1) = pts[0], pts[-1]
    full = [(*xy(c0, r0), T)] + [(*xy(c, r), WIRE_Z) for c, r in pts]
    full.append((*xy(c1, r1), T if is_hole(c1, r1) else T + 1.2))   # ponta fora da grade: soldada no pino do módulo
    tube('fios', col, full, 0.5)
    for c, r in (pts[0], pts[-1]):
        if is_hole(c, r):
            x, y = xy(c, r)
            cyl('fios', SILVER, (x, y, -0.8), (x, y, T), 0.3)

OBD_COL = {'16': g.RED, '4': g.BLK, '5': g.BLK, '14': g.BLU}
for pin, (c, r) in g.OBD_PADS.items():
    x, y = xy(c, r)
    cyl('fios', SILVER, (x, y, -0.8), (x, y, T), 0.35)
    tube('fios', OBD_COL[pin], [(x, y, T), (x, y, T + 1.3), (x, g.H + 14, T + 1.3)], 0.7)

# ---------------------------------------------------------------- Conector do cabo do BMP180 (barra de 4 pinos macho)
bx = [xy(*cr) for cr in g.BMP_PINS.values()]
box('placa', '#111111', min(p[0] for p in bx) - P / 2, bx[0][1] - P / 2, T, 4 * P, P, MALE_H)
for x, y in bx:
    cyl('placa', GOLD, (x, y, -1.0), (x, y, T + MALE_H + 6.0), 0.32)

# ---------------------------------------------------------------- Lado de baixo: fio estanhado e solda
for name, col, pts in g.TRACKS:
    tube('trilhas', col, [(*xy(c, r), BOT_Z) for c, r in pts], 0.38)
for name, col, a, b in g.LINKS:
    tube('trilhas', col, [(*xy(*a), BOT_Z), (*xy(*b), BOT_Z)], 0.32)
for name, col, pts, _ in g.BOTTOM_WIRES:   # fio isolado por baixo, por cima das trilhas
    tube('trilhas', col, [(*xy(c, r), -1.0) for c, r in pts], 0.45)
legs = set()
for _, a, b, _ in g.RES:
    legs |= {a, b}
for row in (2, 12):
    legs |= {(c, row) for c in range(2, 17)}
legs |= set(g.BUCK_PINS.values()) | set(g.TJA_PINS.values()) | set(g.OBD_PADS.values()) | set(g.CAN_HOLES.values()) | set(g.BMP_PINS.values())
for _, _, pts, _ in g.JUMPERS:
    legs |= {p for p in (pts[0], pts[-1]) if is_hole(*p)}
for track_pts in [t[2] for t in g.TRACKS]:
    legs |= set(g.expand(track_pts))
for c, r in sorted(legs):
    x, y = xy(c, r)
    cyl('trilhas', TIN, (x, y, -0.75), (x, y, 0), 0.72)
for pins in g.FUSE_PINS.values():
    for c, r in pins:
        x, y = xy(c, r)
        cyl('trilhas', TIN, (x, y, -0.8), (x, y, 0), 1.0)

# ---------------------------------------------------------------- Posições para o visor detalhado do painel
# O visor do painel (server/web/.../projeto/public/placa3d.mjs) monta as peças com detalhe a partir daqui.
def rr(v):
    return [round(float(a), 3) for a in v]


def esp_pins():
    out = []
    for row, names in ((2, g.ESP_TOP), (12, g.ESP_BOT)):
        for i, n in enumerate(names):
            out.append({'n': n, 'p': rr(xy(2 + i, row)), 'usado': n in g.ESP_USED and (n != 'GND' or row == 12)})
    return out


def jumper_paths():
    out = []
    for name, col, pts, desc in g.JUMPERS:
        (c0, r0), (c1, r1) = pts[0], pts[-1]
        full = [(*xy(c0, r0), T)] + [(*xy(c, r), WIRE_Z) for c, r in pts]
        full.append((*xy(c1, r1), T if is_hole(c1, r1) else T + 1.2))
        out.append({'n': f'{name}: {desc}', 'cor': col, 'r': 0.5, 'pts': [rr(p) for p in full],
                    'pontas': [rr(xy(c, r)) for c, r in (pts[0], pts[-1]) if is_hole(c, r)]})
    nomes = {'16': 'Cabo OBD, pino 16 (+12 V)', '4': 'Cabo OBD, pino 4 (chassi)', '5': 'Cabo OBD, pino 5 (GND de sinal)', '14': 'Cabo OBD, pino 14 (CAN-L)'}
    for pin, (c, r) in g.OBD_PADS.items():
        x, y = xy(c, r)
        out.append({'n': nomes[pin], 'cor': OBD_COL[pin], 'r': 0.7, 'pts': [rr(p) for p in [(x, y, T), (x, y, T + 1.3), (x, g.H + 14, T + 1.3)]], 'pontas': [rr((x, y))]})
    return out


DET = {
    'alturas': {'T': T, 'FEM_H': FEM_H, 'MALE_H': MALE_H, 'ESP_Z': ESP_Z, 'MOD_Z': MOD_Z, 'MOD_T': MOD_T, 'WIRE_Z': WIRE_Z, 'BOT_Z': BOT_Z, 'FUSE_H': FUSE_H},
    'esp32': {'x0': round(x0, 3), 'y0': round(y0, 3), 'l': g.ESP_L, 'w': g.ESP_W, 'pinos': esp_pins()},
    'tja': {'x0': round(tx0, 3), 'y0': round(ty0, 3), 'l': g.TJA_MM[0], 'w': g.TJA_MM[1],
            'pinos': [{'n': n, 'p': rr(xy(*cr))} for n, cr in g.TJA_PINS.items()],
            'can': [{'n': n, 'p': rr(xy(*cr)), 'furo': rr(xy(*g.CAN_HOLES[n]))} for n, cr in g.TJA_CAN.items()]},
    'rt': {'x0': round(bx0, 3), 'y0': round(by0, 3), 'lado': g.BUCK_MM, 'pinos': [{'n': n, 'p': rr(xy(*cr))} for n, cr in g.BUCK_PINS.items()]},
    'resistores': [{'n': f'{name} 1 kΩ: {desc}', 'a': rr(xy(*a)), 'b': rr(xy(*b))} for name, a, b, desc in g.RES],
    'fusivel': {'c': rr((fcx, fcy)), 'w': fw, 'd': fd, 'h': FUSE_H, 'pinos': [rr(xy(*cr)) for pins in g.FUSE_PINS.values() for cr in pins]},
    'fios': jumper_paths(),
    'trilhas': [{'n': name, 'cor': col, 'pts': [rr(xy(c, r)) for c, r in pts]} for name, col, pts in g.TRACKS]
               + [{'n': name, 'cor': col, 'pts': [rr(xy(*a)), rr(xy(*b))]} for name, col, a, b in g.LINKS],
    'solda': [rr(xy(c, r)) for c, r in sorted(legs)],
    'bmp': [{'n': n, 'p': rr(xy(*cr))} for n, cr in g.BMP_PINS.items()],
    'fios_baixo': [{'n': f'{name}: {desc}', 'cor': col, 'pts': [rr(xy(c, r)) for c, r in pts]} for name, col, pts, desc in g.BOTTOM_WIRES],
}

GRID = {'cols': g.COLS, 'rows': g.ROWS, 'mx': round(g.MX, 3), 'my': round(g.MY, 3), 'p': P, 't': T}
LAYERS = [('esp32', 'ESP32'), ('modulos', 'TJA1050 e RT8272'), ('fusivel', 'Fusível'), ('fios', 'Fios por cima'), ('trilhas', 'Trilhas por baixo')]


# ---------------------------------------------------------------- Saídas
def write_js():
    data = {'W': g.W, 'H': g.H, 'grid': GRID, 'layers': LAYERS, 'parts': parts, 'detalhe': DET}
    text = ('// Gerado por gerar_3d.py: não edite à mão.\n'
            'window.PLACA3D = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    with open(os.path.join(OUT, 'modelo3d-dados.js'), 'w', encoding='utf-8') as fh:
        fh.write(text)
    if os.path.isdir(WEB):
        with open(os.path.join(WEB, 'modelo3d-dados.js'), 'w', encoding='utf-8') as fh:
            fh.write(text)


def scad_v(v):
    return '[' + ', '.join(f'{a:g}' for a in v) + ']'


def write_scad():
    out = ['// Placa ilhada da escuta CAN (Uno Vivace): modelo 3D aproximado.',
           '// Gerado por gerar_3d.py: não edite à mão. Abra no OpenSCAD e aperte F5.',
           '// Coordenadas em mm: x para a direita, y para cima (linha 1 no topo), z para cima.',
           '']
    for key, label in LAYERS:
        out.append(f'mostrar_{key} = true;   // {label}')
    out += ['$fn = 16;', '',
            '// as peças vêm com y para baixo (como no desenho 2D); aqui y é invertido',
            'module bx(c, s, cor) color(cor) translate([c[0] - s[0] / 2, -c[1] - s[1] / 2, c[2] - s[2] / 2]) cube(s);',
            'module cl(a, b, r, cor) {',
            '    A = [a[0], -a[1], a[2]]; B = [b[0], -b[1], b[2]]; v = B - A; L = norm(v);',
            '    if (L > 0) color(cor) translate(A) rotate([0, acos(v[2] / L), atan2(v[1], v[0])]) cylinder(r = r, h = L);',
            '}',
            'module bl(c, r, cor) color(cor) translate([c[0], -c[1], c[2]]) sphere(r);',
            '',
            f'module ilhas() for (c = [1:{g.COLS}], r = [1:{g.ROWS}]) {{',
            f'    x = {GRID["mx"]} + (c - 1) * {P}; y = -({GRID["my"]} + (r - 1) * {P});',
            f'    color("#d4a24c") {{ translate([x, y, {T}]) cylinder(r = 0.88, h = 0.05); translate([x, y, -0.05]) cylinder(r = 0.88, h = 0.05); }}',
            f'    color("#4e3b22") {{ translate([x, y, {T + 0.05:g}]) cylinder(r = 0.42, h = 0.02); translate([x, y, -0.07]) cylinder(r = 0.42, h = 0.02); }}',
            '}', '']
    by_layer = {}
    for p in parts:
        by_layer.setdefault(p[0], []).append(p)
    for layer, items in by_layer.items():
        out.append(f'module camada_{layer}() {{')
        for p in items:
            kind, col = p[1], p[2]
            if kind == 'box':
                out.append(f'    bx({scad_v(p[3])}, {scad_v(p[4])}, "{col}");')
            elif kind == 'cyl':
                out.append(f'    cl({scad_v(p[3])}, {scad_v(p[4])}, {p[5]:g}, "{col}");')
            else:
                out.append(f'    bl({scad_v(p[3])}, {p[4]:g}, "{col}");')
        out.append('}')
        out.append('')
    out.append('camada_placa();')
    out.append('ilhas();')
    for key, _ in LAYERS:
        out.append(f'if (mostrar_{key}) camada_{key}();')
    with open(os.path.join(OUT, 'modelo3d.scad'), 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(out) + '\n')


def main():
    write_js()
    write_scad()
    print(f'ok: modelo3d-dados.js, modelo3d.scad ({len(parts)} peças)')


if __name__ == '__main__':
    main()
