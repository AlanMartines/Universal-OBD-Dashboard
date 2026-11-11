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
import caixa  # noqa: E402

OUT = g.OUT
# O painel web publica o mesmo modelo em /projeto/placa: a imagem Docker só enxerga server/web, então vai uma cópia.
WEB = os.path.normpath(os.path.join(OUT, '../../../server/web/src/modules/projeto/public'))
P = g.P
hp = g.hp

# ---------------------------------------------------------------- Alturas (mm, estimadas)
T = 1.6                     # placa perfurada
FEM_H = 8.3                 # barra fêmea do ESP32: corpo de 8,3 x 2,34 mm, pinos de 3,2 mm por baixo (desenho do fabricante)
FEM_W, FEM_PINO = 2.34, 3.2
ESP_PINO = 6.0              # pino do ESP32 abaixo do plástico (paquímetro, 10/11/2026: 13 mm da ponta ao topo do Wi-Fi, 7 da base)
ESP_T = 1.5                 # placa do ESP32 (paquímetro)
ESP_WIFI = 3.0              # módulo WROOM-32 acima da placa dele: 7 - 2,5 do plástico - 1,5 da placa
MALE_H = 2.5                # plástico da barra de pinos macho
ESP_Z = T + FEM_H + MALE_H  # fundo da placa do ESP32
MOD_Z = T + FEM_H + MALE_H  # fundo do transceptor e do RT8272: encaixados em barras fêmea, como o ESP32
MOD_T = 1.6                 # placa dos módulos
WIRE_Z = T + 0.6            # fios isolados por cima
BOT_Z = -0.4                # fio estanhado por baixo
FUSE_FEET = 1.0             # suporte AS-06 (desenho do fabricante): pés de 1 mm,
FUSE_CAP = 1.6              # corpo de 11,5 mm e tampa de 1,6 mm
FUSE_H = FUSE_FEET + 11.5 + FUSE_CAP

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
    box('placa', '#212121', x1 - P / 2, y - FEM_W / 2, T, 15 * P, FEM_W, FEM_H)
    for c in range(2, 17):   # pinos da barra fêmea, por baixo da placa
        cyl('placa', GOLD, (xy(c, row)[0], y, -FEM_PINO), (xy(c, row)[0], y, 0), 0.2)

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
box('esp32', '#1a237e', x0, y0, ESP_Z, g.ESP_L, g.ESP_W, ESP_T)
top = ESP_Z + ESP_T
box('esp32', '#263238', x0 + 1.0, cy - 9, top, 25.5, 18, 0.8)
box('esp32', '#b0bec5', x0 + 7.5, cy - 8, top + 0.8, 18, 16, ESP_WIFI - 0.8)
zig = [(x0 + 2.0 + (i % 2) * 3.5, cy - 7 + i * 1.4, top + 0.85) for i in range(11)]   # antena impressa
tube('esp32', '#c9a227', zig, 0.2)
box('esp32', '#cfd8dc', x0 + 44.5, cy - 3.8, top, 6.5, 7.6, 3.0)
for by in (cy - 9.5, cy + 8.2):
    box('esp32', '#eeeeee', x0 + 40, by, top, 3.4, 2.4, 1.2)
    cyl('esp32', '#424242', (x0 + 41.7, by + 1.2, top + 1.2), (x0 + 41.7, by + 1.2, top + 1.7), 0.7)
for row in (2, 12):
    for c in range(2, 17):
        x, y = xy(c, row)
        cyl('esp32', GOLD, (x, y, ESP_Z - ESP_PINO), (x, y, top + 0.8), 0.32)   # a ponta entra uns 6 mm na barra fêmea

HOUSING_H = 8.5             # conector fêmea Dupont (cabos dos sensores e fios do CAN do TJA1050)


def encaixe(pts):
    """Módulo encaixado numa barra fêmea (como o ESP32): corpo da barra na placa, plástico dos pinos macho por cima e os
    pinos, que descem até 0,4 mm da placa; os pinos da barra fêmea saem 3,2 mm por baixo."""
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    deitada = max(xs) - min(xs) > max(ys) - min(ys)
    lx = max(xs) - min(xs) + (P if deitada else FEM_W)
    ly = max(ys) - min(ys) + (FEM_W if deitada else P)
    cx_, cy_ = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    box('modulos', '#212121', cx_ - lx / 2, cy_ - ly / 2, T, lx, ly, FEM_H)
    lx2 = max(xs) - min(xs) + P
    ly2 = max(ys) - min(ys) + P
    box('modulos', '#111111', cx_ - lx2 / 2, cy_ - ly2 / 2, T + FEM_H, lx2 if deitada else P, P if deitada else ly2, MALE_H)
    for x, y in pts:
        cyl('modulos', GOLD, (x, y, T + 0.4), (x, y, MOD_Z + MOD_T + 0.6), 0.32)
        cyl('modulos', GOLD, (x, y, -FEM_PINO), (x, y, 0), 0.2)


def can_fio(n):
    """Fio do CANH ou do CANL do TJA1050: do conector na barra macho da linha 24 até o pino, por cima do módulo."""
    hx, hy = xy(*g.CAN_HOLES[n])
    x, y = xy(*g.TJA_CAN[n])
    z = MOD_Z + MOD_T + 1.2 + (0.0 if n == 'CANH' else 1.0)
    topo_con = T + MALE_H + HOUSING_H
    return [(hx, hy, topo_con), (hx, hy, z), (x, y + 1.6, z), (x, y, MOD_Z + MOD_T + 0.3)]


# ---------------------------------------------------------------- Transceptor: TJA1050 (22 x 11 mm, barra de 4 pinos) ou SN65HVD230
tx0 = ty0 = sx0 = sy0 = 0.0
if g.TJA_PINS:
    vx, vy = xy(*g.TJA_PINS['VCC'])
    _, gy = xy(*g.TJA_PINS['GND'])
    encaixe([xy(*cr) for cr in g.TJA_PINS.values()])
    tx0 = vx - 1.2
    yc = (vy + gy) / 2
    ty0 = yc - g.TJA_MM[1] / 2
    box('modulos', '#1565c0', tx0, ty0, MOD_Z, g.TJA_MM[0], g.TJA_MM[1], MOD_T)
    mt = MOD_Z + MOD_T
    box('modulos', '#212121', tx0 + 5.0, yc - 2.6, mt, 5.6, 5.2, 1.5)
    box('modulos', '#212121', tx0 + 12.4, ty0 + 1.0, mt, 2.4, 1.4, 0.5)
    for dy in (1.8, g.TJA_MM[1] - 1.8):
        cyl('modulos', '#e3f2fd', (tx0 + g.TJA_MM[0] - 2.9, ty0 + dy, mt), (tx0 + g.TJA_MM[0] - 2.9, ty0 + dy, mt + 0.05), 1.1)
    # CANH e CANL: fios curtos soldados por cima do módulo até o conector de 2 vias na barra macho da linha 24
    hxs = [xy(*cr)[0] for cr in g.CAN_HOLES.values()]
    _, hy0 = xy(*g.CAN_HOLES['CANH'])
    box('modulos', '#111111', min(hxs) - P / 2, hy0 - P / 2, T, 2 * P, P, MALE_H)
    box('modulos', '#1b1b1b', min(hxs) - P / 2, hy0 - P / 2, T + MALE_H, 2 * P, P, HOUSING_H)
    for n in g.TJA_CAN:
        hx, hy = xy(*g.CAN_HOLES[n])
        cyl('modulos', GOLD, (hx, hy, -1.0), (hx, hy, T + MALE_H + 6.0), 0.32)
        tube('modulos', g.BLU, can_fio(n), 0.5)

if g.SN_PINS:   # WCMCU-230 (SN65HVD230), 15,7 x 13,9 mm, barra de 6 pinos na borda de baixo, deitado para cima
    sxs = [xy(*cr)[0] for cr in g.SN_PINS.values()]
    _, spy = xy(*g.SN_PINS['3V3'])
    encaixe([xy(*cr) for cr in g.SN_PINS.values()])
    sx0 = (min(sxs) + max(sxs)) / 2 - g.SN_MM[0] / 2
    sy0 = spy + 1.3 - g.SN_MM[1]
    box('modulos', '#1565c0', sx0, sy0, MOD_Z, g.SN_MM[0], g.SN_MM[1], MOD_T)
    mt = MOD_Z + MOD_T
    box('modulos', '#212121', sx0 + 5.6, sy0 + 1.0, mt, 4.6, 5.6, 1.5)          # chip SOIC-8 (VP230)
    box('modulos', '#212121', sx0 + 1.3, sy0 + 6.6, mt, 2.4, 1.3, 0.5)          # R1 (103)
    for dx in (12.0, 13.5):   # R2 (121) retirado: medido 120 ohms entre CANH e CANL (10/11/2026); ficam as ilhas
        box('modulos', TIN, sx0 + dx, sy0 + 6.75, mt, 0.55, 1.0, 0.06)
    for dx in (2.6, g.SN_MM[0] - 2.6):
        cyl('modulos', '#e3f2fd', (sx0 + dx, sy0 + 2.6, mt), (sx0 + dx, sy0 + 2.6, mt + 0.05), 1.6)

# ---------------------------------------------------------------- RT8272 (HW-108, 21 x 21 mm)
ex, ey = xy(*g.BUCK_PINS['EN'])
ox, oy = xy(*g.BUCK_PINS['OUT-'])
encaixe([xy(*g.BUCK_PINS[n]) for n in ('EN', 'IN-', 'IN+')])
encaixe([xy(*g.BUCK_PINS[n]) for n in ('OUT-', 'OUT+')])
bx0, by0 = ox - 1.5, ey - 1.2
box('modulos', '#0d47a1', bx0, by0, MOD_Z, g.BUCK_MM, g.BUCK_MM, MOD_T)
bt = MOD_Z + MOD_T
box('modulos', '#212121', bx0 + 10.5, by0 + 9.5, bt, 9, 9, 4.0)
cyl('modulos', '#424242', (bx0 + 15, by0 + 14, bt + 4.0), (bx0 + 15, by0 + 14, bt + 4.05), 3.6)
box('modulos', '#212121', bx0 + 5.5, by0 + 2.0, bt, 6, 5, 1.2)
box('modulos', '#cfd8dc', bx0 + 0.8, by0 + 0.8, bt, 3.4, 3.4, 2.2)
cyl('modulos', '#78909c', (bx0 + 2.5, by0 + 2.5, bt + 2.2), (bx0 + 2.5, by0 + 2.5, bt + 2.6), 0.9)

# ---------------------------------------------------------------- Suporte AS-06 com tampa e o fusível de vidro de 1,5 A
# Corpo aberto em cima: piso de 3,8 mm e duas torres nas pontas, com as presilhas; o meio fica vazado nas laterais.
# A tampa (26 x 9,6 x 1,6 mm) encaixa por cima com duas abas que descem até perto do fusível.
fcx, fcy = xy(*g.FUSE_C)
fw, fd = g.FUSE_MM
fb = g.FUSE_BODY
FUSE_FLOOR, FUSE_TOWER = 3.8, 5.6
FUSE_TUBE = {'d': 5.0, 'l': 20.0, 'tampa': 5.2, 'z': T + FUSE_FEET + 8.0}   # vidro 5 x 20 mm, terminais de 5,2 mm
FUSE_TABS = [(-5.3, 1), (5.3, -1)]                                         # abas da tampa: x do centro e lado (y)
top = T + FUSE_H - FUSE_CAP
for sx in (-1, 1):   # pés nas pontas
    box('fusivel', '#1b1b1b', fcx + sx * (fb / 2 - 1.5) - 1.5, fcy - fd / 2, T, 3.0, fd, FUSE_FEET)
box('fusivel', '#1b1b1b', fcx - fb / 2, fcy - fd / 2, T + FUSE_FEET, fb, fd, FUSE_FLOOR)
for sx in (-1, 1):   # torres
    torre_x = fcx - fb / 2 if sx < 0 else fcx + fb / 2 - FUSE_TOWER
    box('fusivel', '#1b1b1b', torre_x, fcy - fd / 2, T + FUSE_FEET + FUSE_FLOOR, FUSE_TOWER, fd, top - (T + FUSE_FEET + FUSE_FLOOR))
box('fusivel', '#111111', fcx - fw / 2, fcy - fd / 2, top, fw, fd, FUSE_CAP)
for tx, ty in FUSE_TABS:
    box('fusivel', '#111111', fcx + tx - 2.0, fcy + ty * 2.6 - 0.65, FUSE_TUBE['z'] + FUSE_TUBE['d'] / 2 + 0.3, 4.0, 1.3, top - (FUSE_TUBE['z'] + FUSE_TUBE['d'] / 2 + 0.3))
fz, fl, ft = FUSE_TUBE['z'], FUSE_TUBE['l'], FUSE_TUBE['tampa']
cyl('fusivel', '#cfe3ea', (fcx - fl / 2 + ft, fcy, fz), (fcx + fl / 2 - ft, fcy, fz), 2.4)
for sx in (-1, 1):
    cyl('fusivel', SILVER, (fcx + sx * (fl / 2 - ft), fcy, fz), (fcx + sx * fl / 2, fcy, fz), 2.55)
cyl('fusivel', '#8d6e63', (fcx - fl / 2 + ft, fcy, fz - 1.6), (fcx + fl / 2 - ft, fcy, fz + 1.6), 0.08)   # filamento, na diagonal
for c, r in g.FUSE_PINS.values():
    x, y = xy(c, r)
    cyl('fusivel', SILVER, (x, y, -1.5), (x, y, T + FUSE_FEET), 0.45)

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

# ---------------------------------------------------------------- Cabo OBD2 macho com fios soltos (pigtail)
# Os 4 fios usados descem da linha 24, viram para a direita e entram na capa do cabo, que segue para a direita da placa;
# o do pino 6 (CAN-H) fica cortado e isolado com termorretrátil, os outros 11 cortados rente na boca da capa.
# Comprimento do cabo encurtado no desenho (o de verdade tem 30 cm).
OBD_Z = 4.0                                     # altura do centro do cabo
OBD_BOCA = (g.W + 12.0, g.H + 6.0)              # boca da capa (x, y)
OBD_CAPA_R, OBD_CAPA_FIM = 3.0, g.W + 36.0      # cabo de 6 mm
OBD_PLUG = {'x0': g.W + 44.0, 'l': 26.0, 'w': 42.0, 'h': 17.0}   # corpo do plugue macho (boca virada para longe da placa)
_ordem = ['16', '4', '5', '14']


def obd_wire_pts(pin):
    x, y = xy(*g.OBD_PADS[pin])
    k = _ordem.index(pin)
    faixa = g.H + 2.5 + (3 - k) * 1.6           # o fio mais à esquerda passa por fora, sem cruzar os outros
    by = OBD_BOCA[1] + (1.5 - k) * 1.4          # lado a lado na boca, na mesma ordem das faixas (sem se cruzar)
    return [(x, y, T), (x, y, T + 1.3), (x, faixa, T + 1.3), (g.W + 3, faixa, T + 1.3),
            (OBD_BOCA[0] - 5, by, OBD_Z), (OBD_BOCA[0] + 1.5, by, OBD_Z)]   # entra reto e some dentro da capa


OBD_PIN6_PTS = [(OBD_BOCA[0] + 1.0, OBD_BOCA[1], OBD_Z + 1.45), (OBD_BOCA[0] - 5.0, OBD_BOCA[1] - 0.6, OBD_Z + 2.4)]
for pin in _ordem:
    x, y = xy(*g.OBD_PADS[pin])
    cyl('fios', SILVER, (x, y, -0.8), (x, y, T), 0.35)
    tube('fios', g.OBD_WIRE[pin][1], obd_wire_pts(pin), 0.7)
tube('fios', g.OBD_PIN6[1], OBD_PIN6_PTS, 0.7)
_a, _b = OBD_PIN6_PTS
cyl('fios', '#111111', tuple(_a[i] + (_b[i] - _a[i]) * 0.55 for i in range(3)), tuple(_b[i] + (_b[i] - _a[i]) * 0.15 for i in range(3)), 1.0)   # termorretrátil
cyl('fios', '#111111', (OBD_BOCA[0] - 1.0, OBD_BOCA[1], OBD_Z), (OBD_BOCA[0] + 2.5, OBD_BOCA[1], OBD_Z), OBD_CAPA_R + 0.35)   # termorretrátil na boca
cyl('fios', '#1b1b1b', (OBD_BOCA[0], OBD_BOCA[1], OBD_Z), (OBD_CAPA_FIM, OBD_BOCA[1], OBD_Z), OBD_CAPA_R)
_p = OBD_PLUG
cyl('fios', '#262626', (OBD_CAPA_FIM, OBD_BOCA[1], OBD_Z), (_p['x0'], OBD_BOCA[1], OBD_Z), 4.6)   # alívio de tensão
box('fios', '#2b2b2b', _p['x0'], OBD_BOCA[1] - _p['w'] / 2, OBD_Z - _p['h'] / 2, _p['l'], _p['w'], _p['h'])

# ---------------------------------------------------------------- Conector do cabo do BMP180 (barra de 4 pinos macho)
bx = [xy(*cr) for cr in g.BMP_PINS.values()]
box('placa', '#111111', min(p[0] for p in bx) - P / 2, bx[0][1] - P / 2, T, 4 * P, P, MALE_H)
for x, y in bx:
    cyl('placa', GOLD, (x, y, -1.0), (x, y, T + MALE_H + 6.0), 0.32)

# ---------------------------------------------------------------- Sensor BMP180 (GY-68) na ponta do cabo
# Dentro da caixa, à direita da placa (pedido do Alan em 10/11/2026), deitado num apoio do fundo, com a barra de 5 pinos
# virada para a placa e os pinos para baixo. Cabo de 4 fios com conector fêmea nas duas pontas: sai por cima da placa,
# desce rente à borda direita, corre perto do fundo e chega por baixo do sensor (como o do LSM6DS3).
MOD_Z0 = caixa.PISO_Z + 13.9      # módulos dos sensores: o cabo faz a curva embaixo deles, logo acima do fundo
BMP_MOD = {'x0': g.W + 3.3, 'y0': 48.0, 'l': 15.0, 'w': 13.0, 'z0': MOD_Z0}
BMP_MOD_PINS = ['3.3V', 'SDA', 'SCL', 'GND', 'VCC']   # de cima para baixo, na borda do lado da placa
BMP_WIRE = {'SDA': g.CYA, 'SCL': g.GRN, 'GND': g.BLK, 'VCC': g.RED}
BMP_WIRE_INFO = {'SDA': ('ciano', 'Dados I2C, do D25'), 'SCL': ('verde', 'Relógio I2C, do D26'),
                 'GND': ('preto', 'GND'), 'VCC': ('vermelho', '5 V (no VCC do GY-68)')}
CON_TOP = T + MALE_H + HOUSING_H                      # conector do cabo na placa, por cima


def bmp_mod_pin(n):
    i = BMP_MOD_PINS.index(n)
    return BMP_MOD['x0'] + 1.4, BMP_MOD['y0'] + BMP_MOD['w'] / 2 + (i - 2) * P


MOD_BOT = BMP_MOD['z0'] - MALE_H - HOUSING_H


def cabo_por_baixo(conn, k, z_sobe, desce_y, faixa, mx, my, bot):
    """Do conector da placa ao módulo: sobe, vai para a direita, desce rente à borda da placa na sua faixa (x), corre
    perto do fundo até a altura do pino e entra por baixo do conector do módulo."""
    x, y = conn
    fx = g.W + 0.9 + faixa * 1.25
    return [(x, y, CON_TOP), (x, y, z_sobe), (g.W - 1, y, z_sobe), (fx, desce_y, z_sobe - 2), (fx, desce_y, bot - 1.5),
            (fx, my, bot - 1.5), (mx, my, bot - 2), (mx, my, bot)]


def faixas(pinos_y, para_cima):
    """Faixa de cada fio para nenhum cruzar o outro: o que vai mais longe corre mais perto da placa."""
    ordem = sorted(pinos_y, key=lambda n: pinos_y[n], reverse=not para_cima)
    return {n: i for i, n in enumerate(ordem)}


def bmp_cable(n):
    mx, my = bmp_mod_pin(n)
    k = list(g.BMP_PINS).index(n)
    f = faixas({m: bmp_mod_pin(m)[1] for m in g.BMP_PINS}, para_cima=False)
    z = CON_TOP + 1.5 + (len(g.BMP_PINS) - 1 - k) * 1.2   # o de mais à direita vai embaixo: ninguém cruza
    conn = xy(*g.BMP_PINS[n])
    return cabo_por_baixo(conn, k, z, conn[1], f[n], mx, my, MOD_BOT)


Z_MIN = MOD_BOT - 3 - 0.6


bx = [xy(*cr) for cr in g.BMP_PINS.values()]
box('bmp180', '#1b1b1b', min(p[0] for p in bx) - P / 2, bx[0][1] - P / 2, T + MALE_H, 4 * P, P, HOUSING_H)
m = BMP_MOD
box('bmp180', '#1565c0', m['x0'], m['y0'], m['z0'], m['l'], m['w'], 1.6)
box('bmp180', '#c0c0c0', m['x0'] + 8.0, m['y0'] + 4.6, m['z0'] + 1.6, 3.8, 3.6, 0.95)   # BMP180
box('bmp180', '#212121', m['x0'] + 5.2, m['y0'] + 2.0, m['z0'] + 1.6, 2.9, 1.6, 1.1)    # regulador
box('bmp180', '#111111', m['x0'] + 0.13, m['y0'] + m['w'] / 2 - 2.5 * P, m['z0'] - MALE_H, P, 5 * P, MALE_H)
box('bmp180', '#1b1b1b', m['x0'] + 0.13, m['y0'] + m['w'] / 2 - 2.5 * P, MOD_BOT, P, 5 * P, HOUSING_H)
for n in BMP_MOD_PINS:
    mx, my = bmp_mod_pin(n)
    cyl('bmp180', GOLD, (mx, my, MOD_BOT + 2.0), (mx, my, m['z0'] + 1.6 + 0.6), 0.32)
for n, col in BMP_WIRE.items():
    tube('bmp180', col, bmp_cable(n), 0.55)

# ---------------------------------------------------------------- LSM6DS3 (acelerômetro e giroscópio) na ponta de outro cabo
# Conector na linha 16 (o plástico por cima, como o do BMP180). Módulo de 13 x 18 mm (serve para LSM6DS3 ou BMI160),
# dentro da caixa, no canto de cima à direita (abaixo do caminho do plugue USB): deitado no apoio do fundo (fita
# dupla-face), com a fileira de 7 pinos virada para a placa e os pinos para baixo; a fileira de 5 fica sem barra e é o
# lado que encosta no apoio.
# Fios curtos no próprio módulo: CS no 3V3 (modo I2C) e SA0 no GND (endereço 0x6A).
lx = [xy(*cr) for cr in g.LSM_PINS.values()]
box('placa', '#111111', min(p[0] for p in lx) - P / 2, lx[0][1] - P / 2, T, 4 * P, P, MALE_H)
for x, y in lx:
    cyl('placa', GOLD, (x, y, -1.0), (x, y, T + MALE_H + 6.0), 0.32)
LSM_MOD = {'x0': g.W + 4.0, 'y0': 2.0, 'l': 13.0, 'w': 18.0, 'z0': MOD_Z0}   # canto de cima à direita, embaixo do plugue USB
LSM_PINS7 = ['VIN', '3V3', 'GND', 'SCL', 'SDA', 'CS', 'SA0']   # de cima para baixo, na borda do lado da placa
LSM_PINS5 = ['OCS', 'INT2', 'INT1', 'SCX', 'SDX']
LSM_WIRE = {'SDA': 'SDA', 'SCL': 'SCL', 'GND': 'GND', 'VCC': 'VIN'}   # pino do conector da placa → pino do módulo
LSM_WIRE_INFO = {'SDA': ('ciano', 'Dados I2C, do D25'), 'SCL': ('verde', 'Relógio I2C, do D26'),
                 'GND': ('preto', 'GND'), 'VCC': ('vermelho', '5 V (no VIN, o módulo tem regulador)')}


def lsm_pin(n):
    if n in LSM_PINS7:
        return LSM_MOD['x0'] + 1.3, LSM_MOD['y0'] + LSM_MOD['w'] / 2 + (LSM_PINS7.index(n) - 3) * P
    return LSM_MOD['x0'] + LSM_MOD['l'] - 1.3, LSM_MOD['y0'] + LSM_MOD['w'] / 2 + (LSM_PINS5.index(n) - 2) * P


LSM_BOT = LSM_MOD['z0'] - MALE_H - HOUSING_H


def lsm_cable(n):
    """Sai do conector para a direita, desce rente à borda da placa, corre perto do fundo e chega por baixo do módulo."""
    mx, my = lsm_pin(LSM_WIRE[n])
    k = list(g.LSM_PINS).index(n)
    f = faixas({m: lsm_pin(LSM_WIRE[m])[1] for m in g.LSM_PINS}, para_cima=True)
    conn = xy(*g.LSM_PINS[n])
    return cabo_por_baixo(conn, k, CON_TOP + 2 + (len(g.LSM_PINS) - 1 - k) * 1.2, conn[1] - 2, f[n], mx, my, LSM_BOT)


def lsm_jumper(a, b, dx, dz):
    (ax, ay), (bx_, by_) = lsm_pin(a), lsm_pin(b)
    top = LSM_MOD['z0'] + 1.6
    return [(ax, ay, top + 0.3), (ax + dx, ay, top + dz), (bx_ + dx, by_, top + dz), (bx_, by_, top + 0.3)]


LSM_JUMPERS = [('CS no 3V3 (modo I2C)', 'CS', '3V3', 1.9, 0.55), ('SA0 no GND (endereço 0x6A)', 'SA0', 'GND', 2.6, 0.95)]
box('lsm6ds3', '#1b1b1b', min(p[0] for p in lx) - P / 2, lx[0][1] - P / 2, T + MALE_H, 4 * P, P, HOUSING_H)
m = LSM_MOD
box('lsm6ds3', '#6a1b9a', m['x0'], m['y0'], m['z0'], m['l'], m['w'], 1.6)
box('lsm6ds3', '#212121', m['x0'] + 5.4, m['y0'] + 7.7, m['z0'] + 1.6, 2.5, 3.0, 0.86)   # LSM6DS3 (LGA de 2,5 x 3 mm)
box('lsm6ds3', '#212121', m['x0'] + 8.8, m['y0'] + 13.0, m['z0'] + 1.6, 3.0, 1.7, 1.1)   # regulador
box('lsm6ds3', '#111111', m['x0'] + 0.03, m['y0'] + m['w'] / 2 - 3.5 * P, m['z0'] - MALE_H, P, 7 * P, MALE_H)
box('lsm6ds3', '#1b1b1b', m['x0'] + 0.03, m['y0'] + m['w'] / 2 - 3.5 * P, LSM_BOT, P, 7 * P, HOUSING_H)
for n in LSM_PINS7:
    mx, my = lsm_pin(n)
    cyl('lsm6ds3', GOLD, (mx, my, LSM_BOT + 2.0), (mx, my, m['z0'] + 1.6 + 0.6), 0.32)
for n in g.LSM_PINS:
    tube('lsm6ds3', BMP_WIRE[n], lsm_cable(n), 0.55)
for _, a, b, dx, dz in LSM_JUMPERS:
    tube('lsm6ds3', '#9e9e9e', lsm_jumper(a, b, dx, dz), 0.3)

# ---------------------------------------------------------------- LED tricolor (opcional) na tampa da caixa
# Conector de 5 pinos macho na linha 1 (colunas 8 a 12): comum, sem ligação, vermelho, verde e azul. O LED de 5 mm fica
# num furo da tampa, perto do conector, preso por dentro (a aba encosta na tampa); fios com conector fêmea em cada pino
# e um resistor de 220 a 330 Ω em cada cor, soldado na perna do LED e coberto com termorretrátil.
LED_C = (xy(10, 1)[0], 2.8)
LED_Z = caixa.TOPO_Z - 1.0                  # aba do LED, por dentro da tampa
LED_ORDEM = ['R', 'COM', 'G', 'B']          # pernas do LED de 4 pernas; a do comum é a mais comprida
lhx = [xy(*cr)[0] for cr in g.LED_HEADER]
_, lhy = xy(*g.LED_HEADER[0])
box('placa', '#111111', min(lhx) - P / 2, lhy - P / 2, T, len(lhx) * P, P, MALE_H)
for x in lhx:
    cyl('placa', GOLD, (x, lhy, -1.0), (x, lhy, T + MALE_H + 6.0), 0.32)


def led_fio(n):
    x, y = xy(*g.LED_PINS[n])
    lx = LED_C[0] + (LED_ORDEM.index(n) - 1.5) * 1.27
    z0 = T + MALE_H + HOUSING_H
    return [(x, y, z0), (x, y, z0 + 1.2 + LED_ORDEM.index(n) * 0.5), (lx, LED_C[1], LED_Z - 3.2), (lx, LED_C[1], LED_Z)]


for n in g.LED_PINS:
    x, y = xy(*g.LED_PINS[n])
    box('led', '#1b1b1b', x - P / 2, y - P / 2, T + MALE_H, P, P, HOUSING_H)
    tube('led', g.LED_COL[n], led_fio(n), 0.45)
    if n != 'COM':   # resistor no termorretrátil, logo abaixo do LED
        a, b = led_fio(n)[2], led_fio(n)[3]
        cyl('led', '#212121', a, b, 0.9)
cyl('led', '#eef3f6', (LED_C[0], LED_C[1], LED_Z), (LED_C[0], LED_C[1], LED_Z + 1.0), 2.9)                      # aba
cyl('led', '#eef3f6', (LED_C[0], LED_C[1], LED_Z + 1.0), (LED_C[0], LED_C[1], caixa.TOPO_Z + 5.1), 2.5)       # corpo
ball('led', '#eef3f6', (LED_C[0], LED_C[1], caixa.TOPO_Z + 5.1), 2.5)

# ---------------------------------------------------------------- ELM327 e cabo Y (acessórios, soltos atrás da placa)
# Só para mostrar o kit: não estão ligados. Medidas aproximadas pelas fotos do vendedor (as fotos não vão ao repositório).
# ELM327 mini em pé, com o plugue para cima; cabo Y com o macho e as duas fêmeas deitados, as bocas para cima, e os
# cabos chatos de 16 vias (encurtados no desenho; o de verdade tem uns 30 cm) correndo atrás.
AC_Z = caixa.outer()['z0']
# ELM327 mini: 47 × 24 mm e 30 mm de altura total (medidas do vendedor, 11/11/2026); a divisão corpo/conector é
# estimada pela foto. Por dentro (fotos da montagem): placa do Bluetooth perto do fundo, placa principal com o
# PIC18F25K80 por cima, ligadas por J1/J2, e os 16 pinos subindo até o conector.
ELM = {'c': (18.0, -34.0), 'w': 47.0, 'd': 24.0, 'h': 19.0, 'plugue': 11.0, 'plugue_w': 40.0}
CON_Y = {'w': 42.0, 'd': 24.0, 'h': 10.0}
Y_MACHO = (72.0, -32.0)
Y_FEMEAS = [(118.0, -32.0), (162.0, -32.0)]
FITA = {'w': 12.0, 't': 1.2}


def fitas():
    """Caminhos dos dois cabos chatos, do macho a cada fêmea, em linhas retas (sem se cruzar)."""
    mx, my = Y_MACHO
    tras = my - CON_Y['d'] / 2
    out = []
    for k, (fx, fy) in enumerate(Y_FEMEAS):
        x0 = mx + (7.0 if k == 0 else -7.0)
        yy = tras - (10.0 if k == 0 else 23.0)
        out.append([(x0, tras), (x0, yy), (fx, yy), (fx, fy - CON_Y['d'] / 2)])
    return out


ex, ey = ELM['c']
box('acessorios', '#1f4fd8', ex - ELM['w'] / 2, ey - ELM['d'] / 2, AC_Z, ELM['w'], ELM['d'], ELM['h'])
box('acessorios', '#1f4fd8', ex - ELM['plugue_w'] / 2, ey - 7, AC_Z + ELM['h'], ELM['plugue_w'], 14, ELM['plugue'])
for cx_, cy_ in [Y_MACHO] + Y_FEMEAS:
    box('acessorios', '#2a2a2a', cx_ - CON_Y['w'] / 2, cy_ - CON_Y['d'] / 2, AC_Z, CON_Y['w'], CON_Y['d'], CON_Y['h'])
    box('acessorios', '#2a2a2a', cx_ - 18, cy_ - 6.5, AC_Z + CON_Y['h'], 36, 13, 9)
for pts in fitas():
    for (ax, ay), (bx_, by_) in zip(pts, pts[1:]):
        w = FITA['w'] / 2
        box('acessorios', '#333333', min(ax, bx_) - w, min(ay, by_) - w, AC_Z, abs(bx_ - ax) + 2 * w, abs(by_ - ay) + 2 * w, FITA['t'])

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
legs |= set(g.BUCK_PINS.values()) | set(g.TRANS_PINS.values()) | set(g.OBD_PADS.values()) | set(g.CAN_HOLES.values()) | set(g.BMP_PINS.values()) | set(g.LSM_PINS.values())
for _, _, pts, _ in g.JUMPERS:
    legs |= {p for p in (pts[0], pts[-1]) if is_hole(*p)}
for track_pts in [t[2] for t in g.TRACKS]:
    legs |= set(g.expand(track_pts))
for c, r in sorted(legs):
    x, y = xy(c, r)
    cyl('trilhas', TIN, (x, y, -0.75), (x, y, 0), 0.72)
for c, r in g.FUSE_PINS.values():
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
    return out


def obd_cable():
    nomes = {'16': 'pino 16 (+12 V)', '4': 'pino 4 (chassi)', '5': 'pino 5 (GND de sinal)', '14': 'pino 14 (CAN-L)'}
    funcoes = {'16': '+12 V (vai ao fusível)', '4': 'Terra do chassi', '5': 'Terra de sinal', '14': 'CAN-L'}
    fios = []
    for pin in _ordem:
        cor_nome, cor, listra = g.OBD_WIRE[pin]
        fios.append({'n': f'Cabo OBD, {nomes[pin]}: fio {cor_nome}', 'pino': pin, 'funcao': funcoes[pin], 'cor_nome': cor_nome,
                     'cor': cor, 'listra': listra,
                     'pts': [rr(p) for p in obd_wire_pts(pin)], 'ponta': rr(xy(*g.OBD_PADS[pin]))})
    return {'fios': fios, 'pino6': {'n': f'Cabo OBD, pino 6 (CAN-H): fio {g.OBD_PIN6[0]}, cortado e isolado, sem ligação',
                                     'pino': '6', 'funcao': 'CAN-H, isolado (sem ligação)', 'cor_nome': g.OBD_PIN6[0],
                                     'cor': g.OBD_PIN6[1], 'pts': [rr(p) for p in OBD_PIN6_PTS]},
            'boca': rr((*OBD_BOCA, OBD_Z)), 'capa_r': OBD_CAPA_R, 'capa_fim': OBD_CAPA_FIM, 'plugue': OBD_PLUG}


DET = {
    'alturas': {'ENCAIXE': True, 'HOUSING_H': HOUSING_H, 'T': T, 'FEM_H': FEM_H, 'FEM_W': FEM_W, 'FEM_PINO': FEM_PINO, 'ESP_PINO': ESP_PINO, 'ESP_T': ESP_T, 'ESP_WIFI': ESP_WIFI, 'MALE_H': MALE_H, 'ESP_Z': ESP_Z, 'MOD_Z': MOD_Z, 'MOD_T': MOD_T, 'WIRE_Z': WIRE_Z, 'BOT_Z': BOT_Z, 'FUSE_H': FUSE_H},
    'esp32': {'x0': round(x0, 3), 'y0': round(y0, 3), 'l': g.ESP_L, 'w': g.ESP_W, 'pinos': esp_pins()},
    'versao': g.VARIANTE,
    'tja': {'x0': round(tx0, 3), 'y0': round(ty0, 3), 'l': g.TJA_MM[0], 'w': g.TJA_MM[1],
            'pinos': [{'n': n, 'p': rr(xy(*cr))} for n, cr in g.TJA_PINS.items()],
            'can': [{'n': n, 'p': rr(xy(*cr)), 'furo': rr(xy(*g.CAN_HOLES[n])), 'furo_cr': list(g.CAN_HOLES[n]),
                     'fio': [rr(p) for p in can_fio(n)]} for n, cr in g.TJA_CAN.items()]} if g.TJA_PINS else None,
    'sn65': {'x0': round(sx0, 3), 'y0': round(sy0, 3), 'l': g.SN_MM[0], 'w': g.SN_MM[1],
             'pinos': [{'n': n, 'p': rr(xy(*cr))} for n, cr in g.SN_PINS.items()]} if g.SN_PINS else None,
    'rt': {'x0': round(bx0, 3), 'y0': round(by0, 3), 'lado': g.BUCK_MM, 'pinos': [{'n': n, 'p': rr(xy(*cr))} for n, cr in g.BUCK_PINS.items()]},
    'resistores': [{'n': f'{name} 1 kΩ: {desc}', 'a': rr(xy(*a)), 'b': rr(xy(*b))} for name, a, b, desc in g.RES],
    'fusivel': {'c': rr((fcx, fcy)), 'w': fw, 'd': fd, 'h': FUSE_H, 'corpo': fb, 'pes': FUSE_FEET, 'tampa': FUSE_CAP,
                'piso': FUSE_FLOOR, 'torre': FUSE_TOWER, 'vidro': FUSE_TUBE, 'abas': [{'x': tx, 'lado': ty} for tx, ty in FUSE_TABS],
                'pinos': [rr(xy(*cr)) for cr in g.FUSE_PINS.values()]},
    'fios': jumper_paths(),
    'cabo_obd': obd_cable(),
    'trilhas': [{'n': name, 'cor': col, 'pts': [rr(xy(c, r)) for c, r in pts]} for name, col, pts in g.TRACKS]
               + [{'n': name, 'cor': col, 'pts': [rr(xy(*a)), rr(xy(*b))]} for name, col, a, b in g.LINKS],
    'solda': [rr(xy(c, r)) for c, r in sorted(legs)],
    'bmp': [{'n': n, 'p': rr(xy(*cr))} for n, cr in g.BMP_PINS.items()],
    'lsm': [{'n': n, 'p': rr(xy(*cr))} for n, cr in g.LSM_PINS.items()],
    'lsm_modulo': {**{k: round(v, 3) for k, v in LSM_MOD.items()}, 'housing': HOUSING_H,
                   'pinos7': [{'n': n, 'p': rr(lsm_pin(n))} for n in LSM_PINS7],
                   'pinos5': [{'n': n, 'p': rr(lsm_pin(n))} for n in LSM_PINS5],
                   'cabo': [{'n': LSM_WIRE[n], 'cor': BMP_WIRE[n], 'cor_nome': LSM_WIRE_INFO[n][0], 'funcao': LSM_WIRE_INFO[n][1],
                             'pts': [rr(p) for p in lsm_cable(n)]} for n in g.LSM_PINS],
                   'jumpers': [{'n': f'Fio curto no módulo: {nome}', 'pts': [rr(p) for p in lsm_jumper(a, b, dx, dz)]}
                               for nome, a, b, dx, dz in LSM_JUMPERS]},
    'bmp_modulo': {**{k: round(v, 3) for k, v in BMP_MOD.items()}, 'housing': HOUSING_H,
                   'z_min': round(Z_MIN, 3),
                   'pinos': [{'n': n, 'p': rr(bmp_mod_pin(n))} for n in BMP_MOD_PINS],
                   'cabo': [{'n': n, 'cor': BMP_WIRE[n], 'cor_nome': BMP_WIRE_INFO[n][0], 'funcao': BMP_WIRE_INFO[n][1],
                             'pts': [rr(p) for p in bmp_cable(n)]} for n in BMP_WIRE]},
    'led': {'c': rr(LED_C), 'z': LED_Z, 'topo': caixa.TOPO_Z + 5.1, 'ordem': LED_ORDEM,
            'conector': [{'n': n, 'p': rr(xy(*cr)), 'esp': g.LED_ESP[n]} for n, cr in g.LED_PINS.items()],
            'pinos': [rr(xy(*cr)) for cr in g.LED_HEADER],
            'fios': [{'n': n, 'cor': g.LED_COL[n], 'pts': [rr(p) for p in led_fio(n)], 'resistor': n != 'COM'} for n in g.LED_PINS]},
    'acessorios': {'z0': AC_Z, 'elm': {**ELM, 'c': rr(ELM['c'])}, 'con': CON_Y, 'macho': rr(Y_MACHO),
                   'femeas': [rr(f) for f in Y_FEMEAS], 'fita': FITA, 'fitas': [[rr(p) for p in f] for f in fitas()]},
    'fios_baixo': [{'n': f'{name}: {desc}', 'cor': col, 'pts': [rr(xy(c, r)) for c, r in pts]} for name, col, pts, desc in g.BOTTOM_WIRES],
}

# ---------------------------------------------------------------- Caixa de proteção (caixa.py)
# A mesma caixa serve às duas versões da placa; as posições de referência vêm deste modelo.
CAIXA_REF = {
    'placa': (g.W, g.H, T),
    'usb_y': (xy(2, 2)[1] + xy(2, 12)[1]) / 2, 'usb_z': ESP_Z + ESP_T + 1.3,
    'obd_y': OBD_BOCA[1], 'obd_z': OBD_Z, 'obd_r': OBD_CAPA_R,
    'apoios': [(LSM_MOD, 5.0, 'LSM6DS3'), (BMP_MOD, 5.0, 'BMP180')],   # módulo, onde o apoio começa (x), nome
    'fusivel': (fcx, fcy, T + FUSE_H),
    # furos da tampa: o LED azul do ESP32 (na placa dele, perto do USB) e o LED tricolor opcional
    # LED azul (D2) do ESP32: logo antes do módulo WROOM, do lado do 3V3, a ~22 mm da ponta do USB (conferido na placa, 11/11/2026)
    'furos_tampa': [(x0 + g.ESP_L - 22.3, (xy(2, 2)[1] + xy(2, 12)[1]) / 2 - 4.3, 1.5, 'Tampa: furo de 3 mm para ver o LED azul do ESP32'),
                    (LED_C[0], LED_C[1], 2.55, 'Tampa: furo de 5 mm do LED tricolor')],
}
CAIXA = caixa.montar(CAIXA_REF)
DET['caixa'] = {'base': CAIXA['base'], 'tampa': CAIXA['tampa'], 'medidas': CAIXA['medidas'],
                'externa': {k: round(v, 3) for k, v in CAIXA['externa'].items()},
                'interna': {k: round(v, 3) for k, v in CAIXA['interna'].items()}}


def _aabb(p):
    if p[1] == 'box':
        c, sz = p[3], p[4]
        return [c[i] - sz[i] / 2 for i in range(3)], [c[i] + sz[i] / 2 for i in range(3)]
    if p[1] == 'cyl':   # o disco das pontas só se estende para os lados do eixo
        a, b, r = p[3], p[4], p[5]
        d = [b[i] - a[i] for i in range(3)]
        ln = math.sqrt(sum(v * v for v in d)) or 1.0
        e = [r * math.sqrt(max(0.0, 1 - (d[i] / ln) ** 2)) for i in range(3)]
        return [min(a[i], b[i]) - e[i] for i in range(3)], [max(a[i], b[i]) + e[i] for i in range(3)]
    c, r = p[3], p[4]
    return [c[i] - r for i in range(3)], [c[i] + r for i in range(3)]


def _aabb_caixa(q):
    if q['t'] == 'box':
        return q['a'], q['b']
    r = q['r'] if q['t'] != 'furada' else max(q['w'], q['h']) / 2
    return [q['c'][0] - r, q['c'][1] - r, q['z'][0]], [q['c'][0] + r, q['c'][1] + r, q['z'][1]]


def conferir_caixa():
    """Lista peças do modelo que encostam em peças da caixa (pelas caixas envolventes: pode acusar a mais)."""
    achados = []
    for q in CAIXA['base'] + CAIXA['tampa']:
        qa, qb = _aabb_caixa(q)
        for p in parts:
            if p[0] == 'led' and 'LED' in (q['n'] or ''):   # o LED atravessa o furo dele
                continue
            pa, pb = _aabb(p)
            if all(pa[i] < qb[i] - 0.01 and qa[i] < pb[i] - 0.01 for i in range(3)):
                achados.append((q['n'], p[0], p[1], [round(v, 1) for v in pa], [round(v, 1) for v in pb]))
    return achados


GRID = {'cols': g.COLS, 'rows': g.ROWS, 'mx': round(g.MX, 3), 'my': round(g.MY, 3), 'p': P, 't': T}
LAYERS = [('esp32', 'ESP32'), ('modulos', f'{g.TRANS_NOME} e RT8272'), ('fusivel', 'Fusível'), ('bmp180', 'BMP180'), ('lsm6ds3', 'LSM6DS3'), ('led', 'LED tricolor'), ('fios', 'Fios por cima'), ('acessorios', 'ELM327 e cabo Y'), ('trilhas', 'Trilhas por baixo')]


# ---------------------------------------------------------------- Saídas
def write_js():
    data = {'W': g.W, 'H': g.H, 'grid': GRID, 'layers': LAYERS, 'parts': parts, 'detalhe': DET}
    text = ('// Gerado por gerar_3d.py: não edite à mão.\n'
            'window.PLACA3D = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    with open(os.path.join(OUT, f'modelo3d{g.SUF}-dados.js'), 'w', encoding='utf-8') as fh:
        fh.write(text)
    if os.path.isdir(WEB):
        with open(os.path.join(WEB, f'modelo3d{g.SUF}-dados.js'), 'w', encoding='utf-8') as fh:
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
    with open(os.path.join(OUT, f'modelo3d{g.SUF}.scad'), 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(out) + '\n')


def main():
    write_js()
    write_scad()
    print(f'ok: modelo3d{g.SUF}-dados.js, modelo3d{g.SUF}.scad ({len(parts)} peças)')
    for a in conferir_caixa():
        print('  atenção, encosta na caixa:', *a)
    if g.VARIANTE == 'tja':   # a caixa é a mesma nas duas versões
        nb, nt = caixa.escrever(OUT, CAIXA, CAIXA_REF)
        m = CAIXA['medidas']
        print(f'ok: caixa-base.stl ({nb} triângulos), caixa-tampa.stl ({nt}), caixa.scad, caixa.svg;'
              f' por fora {m["externa"]}, por dentro {m["interna"]}')


if __name__ == '__main__':
    main()
