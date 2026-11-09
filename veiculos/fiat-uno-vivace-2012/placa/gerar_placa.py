#!/usr/bin/env python3
"""Gera a placa ilhada 5 x 7 cm (18 x 24 furos, tamanho padrão) da escuta CAN do Uno Vivace: ESP32 DevKit V1 + TJA1050 + RT8272.

Desenhos (SVG), na mesma pasta deste script:
- esquema.svg: ligação elétrica em blocos;
- etapa1.svg: o que fica embaixo do ESP32 (resistores, pontes e fios), vista de cima;
- etapa2.svg: placa montada, vista de cima;
- baixo.svg: lado da solda (espelhado);
- *-real.svg: as vistas da placa em tamanho real (1:1), para imprimir em 100%;
- modelo3d-dados.js e modelo3d.scad: modelo 3D (gerar_3d.py), para modelo3d.html e o OpenSCAD.

Só biblioteca padrão do Python 3:
    python3 veiculos/fiat-uno-vivace-2012/placa/gerar_placa.py

Medidas de 07/11/2026 (README.md). Confira o RT8272 e o TJA1050 encaixando pelos pinos antes de soldar.
O suporte do fusível (AS-06, 5 x 20 mm, com tampa) está com as medidas do desenho do fabricante: os 2 pinos chatos
caem na grade, mas os furos precisam ser alargados para 1,5 mm.
"""
import os

OUT = os.path.dirname(os.path.abspath(__file__))
P = 2.54
W, H = 50.0, 70.0
COLS, ROWS = 18, 24
MX = (W - (COLS - 1) * P) / 2
MY = (H - (ROWS - 1) * P) / 2

RED, BLK, YEL, BLU, ORG, GRN, PUR, CYA = '#d32f2f', '#263238', '#f9a825', '#1976d2', '#ef6c00', '#2e7d32', '#7b1fa2', '#00838f'
FONT = 'DejaVu Sans, Arial, sans-serif'


def hp(c, r):
    return (MX + (c - 1) * P, MY + (r - 1) * P)


# ---------------------------------------------------------------- Montagem (coluna, linha)
# ESP32 deitado: antena para a esquerda (fora da placa), USB para a direita. Barras fêmea nas linhas 2 e 12, colunas 2 a 16.
ESP_TOP = ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND', '3V3']
ESP_BOT = ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN']
ESP_L, ESP_W = 50.0, 28.0   # medidas do paquímetro; fileiras a 25,4 mm (10 furos)
ESP_USED = {'D21': YEL, '3V3': ORG, 'GND': BLK, 'VIN': RED, 'D25': CYA, 'D26': GRN}

# Resistores 1 kΩ (marrom, preto, vermelho)
RES = [
    ('R1', (7, 3), (11, 3), 'D21 → RX do TJA1050'),
    ('R2', (6, 4), (6, 8), 'D21 → R3 (divisor)'),
    ('R3', (7, 8), (11, 8), 'R2 → GND (divisor)'),
    ('R4', (16, 3), (16, 7), '3V3 → CANH'),
]
# Ilhas de ligação dos módulos e do cabo
# TJA1050: módulo de 22 x 11 mm. Barra de 4 pinos (VCC, TX, RX, GND) soldada na coluna 11, linhas 19 a 22; o módulo
# fica deitado para a direita. CANH e CANL ficam na outra ponta, cerca de 19,4 mm adiante, fora da grade: cada um desce por
# uma perna curta (sobra de perna de resistor) até a ilha da coluna 18 logo abaixo, e a ligação segue por baixo.
TJA_PINS = {'VCC': (11, 19), 'TX': (11, 20), 'RX': (11, 21), 'GND': (11, 22)}
TJA_CAN = {'CANH': (11 + 19.4 / P, 20), 'CANL': (11 + 19.4 / P, 21)}
CAN_HOLES = {'CANH': (18, 20), 'CANL': (18, 21)}
OBD_PADS = {'16': (11, 24), '4': (12, 24), '5': (13, 24), '14': (18, 24)}
# Cabo OBD2 macho com fios soltos ("pigtail", 16 fios): cores da tabela do vendedor. Confira com o multímetro
# (continuidade do pino até o fio) antes de soldar: as cores mudam de um fabricante para outro.
# (nome da cor, cor do fio, cor da listra ou None)
OBD_WIRE = {'16': ('vermelho', '#d32f2f', None), '4': ('laranja', '#ef6c00', None),
            '5': ('azul-claro', '#4fc3f7', None), '14': ('verde/branco', '#2e7d32', '#ffffff')}
# Pino 6 (CAN-H, verde) fica sem ligação: cortado e isolado com termorretrátil. Os outros 11 fios, cortados rente.
OBD_PIN6 = ('verde', '#43a047')
# Suporte de fusível 5 x 20 mm para placa, com tampa (AS-06), e fusível de vidro de 1,5 A.
# Desenho do fabricante: tampa de 26 x 9,6 mm (1,6 mm de espessura), corpo de 24,5 mm, 14,1 mm de altura sobre a placa
# (pés de 1 mm + 11,5 + tampa); 2 pinos chatos de 1,3 x 0,4 mm a 20,2 ± 0,3 mm, no meio da largura.
# 8 furos da grade dão 20,32 mm: os pinos caem nos furos (1,24) e (9,24), alargados para 1,5 mm.
# Deitado na linha 24, embaixo do RT8272; o fusível não tem lado, mas a entrada (12 V do OBD) fica à direita.
FUSE_MM = (26.0, 9.6)
FUSE_BODY = 24.5
FUSE_C = (5, 24)
FUSE_PINS = {'OUT': (1, 24), 'IN': (9, 24)}
FUSE_DRILL = 1.5

# Conector de 4 pinos para o cabo do sensor BMP180 (o sensor fica longe do calor da placa), acima do TJA1050.
# Ordem: SDA, SCL, GND, VCC. VCC vem do 5 V: use o GY-68, que tem regulador próprio (pinos VCC e 3.3V).
BMP_PINS = {'SDA': (12, 17), 'SCL': (13, 17), 'GND': (14, 17), 'VCC': (15, 17)}
BMP_COL = {'SDA': CYA, 'SCL': GRN, 'GND': BLK, 'VCC': RED}

# Trilhas de solda (lado de baixo): fio estanhado passando pelos furos, sempre em linha reta
TRACKS = [
    ('D21', YEL, [(6, 2), (6, 3), (7, 3)]),
    ('D21', YEL, [(6, 3), (6, 4)]),
    ('Divisor', YEL, [(6, 8), (7, 8)]),
    ('GND', BLK, [(11, 8), (15, 8), (15, 13), (9, 13), (9, 22), (12, 22), (12, 24), (13, 24)]),
    ('GND → IN−', BLK, [(8, 15), (9, 15)]),
    ('3V3', ORG, [(16, 2), (16, 3)]),
    ('5 V', RED, [(16, 12), (16, 18), (10, 18), (10, 17)]),
    ('5 V do TJA1050', RED, [(11, 18), (11, 20)]),
    ('RX', YEL, [(11, 21), (17, 21), (17, 17)]),
    ('12 V do OBD → fusível', RED, [(11, 24), (9, 24)]),
    ('12 V com fusível', PUR, [(1, 24), (1, 23), (8, 23), (8, 16)]),
    ('OUT+ → J3', RED, [(1, 21), (2, 21), (2, 13)]),
    ('CANH', BLU, [(18, 17), (18, 20)]),
    ('CAN-L', BLU, [(18, 21), (18, 24)]),
    ('GND do BMP180', BLK, [(14, 13), (14, 17)]),
    ('5 V do BMP180', RED, [(15, 17), (16, 17)]),
]
# Fios isolados por baixo, soldados nos pinos: o I2C do BMP180 cruza a trilha de GND da linha 13 sem encostar.
# Pontos em meio furo (x.5) passam entre as ilhas.
BOTTOM_WIRES = [
    ('F1', CYA, [(9, 12), (9.5, 12.5), (9.5, 13.5), (11.5, 13.5), (11.5, 16.5), (12, 17)], 'SDA: D25 → conector do BMP180'),
    ('F2', GRN, [(10, 12), (10.5, 12.5), (12.5, 12.5), (12.5, 16.5), (13, 17)], 'SCL: D26 → conector do BMP180'),
]
# Fios isolados por cima da placa (J1 e J2 passam embaixo do ESP32)
# Fio estanhado curto, lado de baixo, até um ponto fora da grade (nenhum hoje: os pinos do AS-06 caem na grade)
LINKS = []
JUMPERS = [
    ('J1', YEL, [(11, 3), (17, 3), (17, 17)], 'R1 → RX do TJA1050'),
    ('J2', BLU, [(16, 7), (18, 7), (18, 17)], 'R4 → CANH (segue por baixo até a perna do CANH)'),
    ('J3', RED, [(2, 13), (9, 13), (9, 17), (10, 17)], 'OUT+ do RT8272 → 5 V'),
]
TJA_MM = (22.0, 11.0)
# RT8272 (HW-108): 21 x 21 mm, fileiras a cerca de 17,8 mm (7 furos), medido em 07/11/2026.
# Soldado na placa por barra de pinos, com a bobina embaixo à direita: EN, IN-, IN+ na coluna 8 (linhas 14 a 16);
# OUT-, OUT+ na coluna 1 (linhas 20 e 21). Uma linha acima do desenho de 07/11, para caber o suporte do fusível. IN- e OUT- são o mesmo GND dentro do módulo; o EN fica sem ligação.
BUCK_MM = 21.0
BUCK_PINS = {'EN': (8, 14), 'IN-': (8, 15), 'IN+': (8, 16), 'OUT-': (1, 20), 'OUT+': (1, 21)}
BUCK_COL = {'EN': '#9e9e9e', 'IN-': BLK, 'IN+': PUR, 'OUT-': BLK, 'OUT+': RED}


def expand(pts):
    """Furos por onde passa uma trilha reta entre pontos (coluna, linha)."""
    out = []
    for (c1, r1), (c2, r2) in zip(pts, pts[1:]):
        if c1 == c2:
            step = 1 if r2 >= r1 else -1
            out += [(c1, r) for r in range(int(r1), int(r2) + step, step)]
        else:
            step = 1 if c2 >= c1 else -1
            out += [(c, r1) for c in range(int(c1), int(c2) + step, step)]
    return out


# ---------------------------------------------------------------- Desenho
class Svg:
    def __init__(self, w, h, scale, pad=6.0):
        self.w, self.h, self.scale, self.pad = w, h, scale, pad
        self.o = []

    def add(self, s):
        self.o.append(s)

    def text(self, x, y, t, size=1.3, color=BLK, anchor='middle', weight='normal', rotate=None, bg=False):
        tr = f' transform="rotate({rotate} {x:.2f} {y:.2f})"' if rotate else ''
        if bg:
            wbox = len(t) * size * 0.62 + 0.8
            self.add(f'<rect x="{x - wbox / 2 if anchor == "middle" else (x - 0.4 if anchor == "start" else x - wbox + 0.4):.2f}" y="{y - size * 0.85:.2f}" width="{wbox:.2f}" height="{size * 1.15:.2f}" rx="0.35" fill="#fff" opacity=".9"{tr}/>')
        self.add(f'<text x="{x:.2f}" y="{y:.2f}" font-size="{size}" fill="{color}" text-anchor="{anchor}" font-weight="{weight}" font-family="{FONT}"{tr}>{t}</text>')

    def svg(self):
        p = self.pad
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{(self.w + 2 * p) * self.scale:.1f}mm" height="{(self.h + 2 * p) * self.scale:.1f}mm" '
                f'viewBox="{-p} {-p} {self.w + 2 * p} {self.h + 2 * p}">\n' + '\n'.join(self.o) + '\n</svg>\n')


def board(s, mirror=False, labels=True):
    X = (lambda x: W - x) if mirror else (lambda x: x)
    s.add(f'<rect x="0" y="0" width="{W}" height="{H}" rx="1.5" fill="#efe3c2" stroke="#8d6e63" stroke-width="0.35"/>')
    for c in range(1, COLS + 1):
        for r in range(1, ROWS + 1):
            x, y = hp(c, r)
            s.add(f'<circle cx="{X(x):.2f}" cy="{y:.2f}" r="0.88" fill="#d4a24c"/><circle cx="{X(x):.2f}" cy="{y:.2f}" r="0.4" fill="#4e3b22"/>')
    if labels:
        for c in range(1, COLS + 1):
            x, _ = hp(c, 1)
            s.text(X(x), -1.0, str(c), 1.3, '#6d4c41')
        for r in range(1, ROWS + 1):
            _, y = hp(1, r)
            s.text(-1.8 if not mirror else W + 1.8, y + 0.45, str(r), 1.3, '#6d4c41')
    return X


def resistor(s, a, b, name, show_label=True):
    (x1, y1), (x2, y2) = hp(*a), hp(*b)
    s.add(f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" stroke="#9e9e9e" stroke-width="0.5" stroke-linecap="round"/>')
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    horiz = abs(y1 - y2) < 0.01
    L, D = 6.2, 2.3
    w, h = (L, D) if horiz else (D, L)
    s.add(f'<rect x="{mx - w / 2:.2f}" y="{my - h / 2:.2f}" width="{w}" height="{h}" rx="1.0" fill="#e8d3a9" stroke="#8d6e63" stroke-width="0.2"/>')
    for i, col in enumerate(['#6d4c41', '#212121', '#d32f2f', '#c9a227']):   # marrom, preto, vermelho, ouro = 1 kΩ
        off = -1.9 + i * 1.1 + (0.6 if i == 3 else 0)
        if horiz:
            s.add(f'<rect x="{mx + off - 0.3:.2f}" y="{my - h / 2:.2f}" width="0.6" height="{h}" fill="{col}"/>')
        else:
            s.add(f'<rect x="{mx - w / 2:.2f}" y="{my + off - 0.3:.2f}" width="{w}" height="0.6" fill="{col}"/>')
    if show_label:
        if horiz:
            s.text(mx, my - 1.7, name, 1.4, '#3e2723', weight='bold', bg=True)
        else:
            s.text(mx - 2.2, my + 0.5, name, 1.4, '#3e2723', anchor='end', weight='bold', bg=True)


def pad_mark(s, c, r, color, label=None, where='below', X=lambda x: x, size=1.15):
    x, y = hp(c, r)
    s.add(f'<circle cx="{X(x):.2f}" cy="{y:.2f}" r="1.15" fill="none" stroke="{color}" stroke-width="0.4"/>')
    if label:
        dy = {'below': 2.4, 'above': -1.6}[where]
        s.text(X(x), y + dy, label, size, color, weight='bold', bg=True)


def track(s, pts, color, X, width=1.0, opacity=1.0):
    d = ' '.join(f'{"M" if i == 0 else "L"}{X(hp(c, r)[0]):.2f},{hp(c, r)[1]:.2f}' for i, (c, r) in enumerate(pts))
    s.add(f'<path d="{d}" fill="none" stroke="#b0b7bd" stroke-width="{width + 0.5}" stroke-linecap="round" stroke-linejoin="round" opacity="{opacity}"/>')
    s.add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round" opacity="{opacity}"/>')


def jumper(s, pts, color, name, X=lambda x: x):
    def xy(c, r):
        return X(hp(c, 1)[0] + 0 if True else 0) if False else (X(MX + (c - 1) * P), MY + (r - 1) * P)
    d = ' '.join(f'{"M" if i == 0 else "L"}{xy(c, r)[0]:.2f},{xy(c, r)[1]:.2f}' for i, (c, r) in enumerate(pts))
    s.add(f'<path d="{d}" fill="none" stroke="#37474f" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round"/>')
    s.add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round"/>')
    for c, r in (pts[0], pts[-1]):
        x, y = xy(c, r)
        s.add(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="0.55" fill="#cfd8dc" stroke="#37474f" stroke-width="0.2"/>')
    # nome no meio do trecho mais longo
    segs = list(zip(pts, pts[1:]))
    (a, b) = max(segs, key=lambda ab: abs(ab[0][0] - ab[1][0]) + abs(ab[0][1] - ab[1][1]))
    (x1, y1), (x2, y2) = xy(*a), xy(*b)
    s.text((x1 + x2) / 2, (y1 + y2) / 2 + 0.5, name, 1.3, '#fff', weight='bold')
    s.add(f'<rect x="{(x1 + x2) / 2 - 1.6:.2f}" y="{(y1 + y2) / 2 - 0.75:.2f}" width="3.2" height="1.6" rx="0.5" fill="{color}" stroke="#37474f" stroke-width="0.15"/>')
    s.text((x1 + x2) / 2, (y1 + y2) / 2 + 0.48, name, 1.2, '#fff' if color != YEL else '#3e2723', weight='bold')


def esp32_art(s, ghost=False):
    # placa de 50 x 28 mm (paquímetro, 07/11/2026), barras de 15 pinos centradas
    cx = (hp(2, 2)[0] + hp(16, 2)[0]) / 2
    x0 = cx - ESP_L / 2
    cy = (hp(2, 2)[1] + hp(2, 12)[1]) / 2
    y0 = cy - ESP_W / 2
    op = '0.35' if ghost else '1'
    s.add(f'<g opacity="{op}">')
    s.add(f'<rect x="{x0:.2f}" y="{y0:.2f}" width="{ESP_L}" height="{ESP_W}" rx="1.2" fill="#1a237e" stroke="#0d1442" stroke-width="0.3"/>')
    # módulo ESP-WROOM-32 com antena (à esquerda)
    s.add(f'<rect x="{x0 + 1.0:.2f}" y="{cy - 9:.2f}" width="25.5" height="18" rx="0.6" fill="#263238"/>')
    s.add(f'<rect x="{x0 + 7.5:.2f}" y="{cy - 8:.2f}" width="18" height="16" rx="0.5" fill="#b0bec5" stroke="#78909c" stroke-width="0.2"/>')
    s.text(x0 + 16.5, cy + 0.5, 'ESP32-WROOM-32', 1.5, '#37474f', weight='bold')
    zig = ' '.join(f'{"M" if i == 0 else "L"}{x0 + 2 + (i % 2) * 3.5:.2f},{cy - 7 + i * 1.4:.2f}' for i in range(11))
    s.add(f'<path d="{zig}" fill="none" stroke="#c9a227" stroke-width="0.45"/>')
    s.text(x0 + 3.8, cy + 8.0, 'antena', 1.1, '#c9a227')
    # USB à direita, botões
    s.add(f'<rect x="{x0 + 44.5:.2f}" y="{cy - 3.8:.2f}" width="6.5" height="7.6" rx="0.6" fill="#cfd8dc" stroke="#90a4ae" stroke-width="0.25"/>')
    s.text(x0 + 47.7, cy + 5.6, 'USB', 1.2, '#eceff1')
    for by, nm in ((cy - 9.5, 'BOOT'), (cy + 8.2, 'EN')):
        s.add(f'<rect x="{x0 + 40:.2f}" y="{by:.2f}" width="3.4" height="2.4" rx="0.3" fill="#eeeeee"/><circle cx="{x0 + 41.7:.2f}" cy="{by + 1.2:.2f}" r="0.7" fill="#424242"/>')
    s.text(x0 + 34.5, cy + 0.5, 'ESP32 DevKit V1', 1.6, '#e8eaf6', weight='bold')
    for row, names in ((2, ESP_TOP), (12, ESP_BOT)):
        for i, n in enumerate(names):
            x, y = hp(2 + i, row)
            s.add(f'<rect x="{x - 1.1:.2f}" y="{y - 1.1:.2f}" width="2.2" height="2.2" fill="#111" stroke="#555" stroke-width="0.15"/><circle cx="{x:.2f}" cy="{y:.2f}" r="0.45" fill="#d4af37"/>')
            col = ESP_USED.get(n, '#c5cae9')
            yy = y + 2.5 if row == 2 else y - 1.7
            s.text(x, yy, n, 1.05, col, weight='bold' if n in ESP_USED else 'normal')
    s.add('</g>')


def header_footprint(s):
    """Barras fêmea do ESP32 (sem a placa por cima)."""
    for row, names in ((2, ESP_TOP), (12, ESP_BOT)):
        x1, y = hp(2, row)
        x2, _ = hp(16, row)
        s.add(f'<rect x="{x1 - 1.3:.2f}" y="{y - 1.3:.2f}" width="{x2 - x1 + 2.6:.2f}" height="2.6" rx="0.3" fill="#212121"/>')
        for i, n in enumerate(names):
            x, _ = hp(2 + i, row)
            s.add(f'<rect x="{x - 0.55:.2f}" y="{y - 0.55:.2f}" width="1.1" height="1.1" fill="#000" stroke="#666" stroke-width="0.12"/>')
            col = ESP_USED.get(n, '#9e9e9e')
            yy = y - 1.8 if row == 2 else y + 2.6
            s.text(x, yy, n, 1.0, col, weight='bold' if n in ESP_USED else 'normal')


def tja_art(s):
    """Módulo TJA1050 de 22 x 11 mm sobre a barra de 4 pinos, deitado para a direita."""
    x0 = hp(*TJA_PINS['VCC'])[0] - 1.2
    yc = (hp(*TJA_PINS['VCC'])[1] + hp(*TJA_PINS['GND'])[1]) / 2
    y0 = yc - TJA_MM[1] / 2
    s.add(f'<rect x="{x0:.2f}" y="{y0:.2f}" width="{TJA_MM[0]}" height="{TJA_MM[1]}" rx="0.6" fill="#1565c0" stroke="#0d47a1" stroke-width="0.3"/>')
    for dx in (TJA_MM[0] - 2.9,):
        for dy in (1.8, TJA_MM[1] - 1.8):
            s.add(f'<circle cx="{x0 + dx:.2f}" cy="{y0 + dy:.2f}" r="1.1" fill="#e3f2fd"/>')
    s.add(f'<rect x="{x0 + 5.0:.2f}" y="{yc - 2.6:.2f}" width="5.6" height="5.2" rx="0.3" fill="#212121"/>')
    s.text(x0 + 7.8, yc + 0.5, 'TJA1050', 1.05, '#eceff1', weight='bold')
    s.add(f'<rect x="{x0 + 12.4:.2f}" y="{y0 + 1.0:.2f}" width="2.4" height="1.4" fill="#212121"/>')
    s.text(x0 + 13.6, y0 + 3.6, '121', 0.9, '#e3f2fd')
    for n, (c, r) in list(TJA_PINS.items()) + list(TJA_CAN.items()):
        x, y = MX + (c - 1) * P, MY + (r - 1) * P
        s.add(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="0.65" fill="#d4af37"/>')
        can = n.startswith('CAN')
        s.text(x + (-1.1 if can else 1.1), y + 0.4, n, 0.95, '#fff', anchor='end' if can else 'start', weight='bold')
    # pernas curtas do CANH e do CANL até as ilhas da coluna 18, logo abaixo do módulo
    for n, (c, r) in TJA_CAN.items():
        x, y = MX + (c - 1) * P, MY + (r - 1) * P
        tx, ty = hp(*CAN_HOLES[n])
        s.add(f'<path d="M{x:.2f},{y:.2f} L{tx:.2f},{ty:.2f}" stroke="#9e9e9e" stroke-width="0.45" stroke-linecap="round"/>')


def buck_art(s):
    """Módulo HW-108 de 21 x 21 mm sobre a barra de pinos (bobina 4R7 embaixo à direita)."""
    x0 = hp(*BUCK_PINS['OUT-'])[0] - 1.5
    y0 = hp(*BUCK_PINS['EN'])[1] - 1.2
    s.add(f'<rect x="{x0:.2f}" y="{y0:.2f}" width="{BUCK_MM}" height="{BUCK_MM}" rx="0.6" fill="#0d47a1" stroke="#082a5e" stroke-width="0.3"/>')
    s.add(f'<rect x="{x0 + 10.5:.2f}" y="{y0 + 9.5:.2f}" width="9" height="9" rx="1.2" fill="#212121"/>')
    s.add(f'<circle cx="{x0 + 15:.2f}" cy="{y0 + 14:.2f}" r="3.6" fill="none" stroke="#424242" stroke-width="0.4"/>')
    s.text(x0 + 15, y0 + 14.5, '4R7', 1.3, '#9e9e9e')
    s.add(f'<rect x="{x0 + 5.5:.2f}" y="{y0 + 2.0:.2f}" width="6" height="5" rx="0.4" fill="#212121"/>')
    s.text(x0 + 8.5, y0 + 4.9, 'RT8272', 1.0, '#bdbdbd')
    s.add(f'<rect x="{x0 + 0.8:.2f}" y="{y0 + 0.8:.2f}" width="3.4" height="3.4" rx="0.4" fill="#cfd8dc"/><circle cx="{x0 + 2.5:.2f}" cy="{y0 + 2.5:.2f}" r="0.9" fill="#78909c"/>')
    s.text(x0 + 2.5, y0 + 5.9, 'ajuste', 1.0, '#bbdefb')
    s.text(x0 + 7.5, y0 + 9.6, 'regular 5,0 V', 1.1, '#e3f2fd', weight='bold')
    for n, (c, r) in BUCK_PINS.items():
        px, py = hp(c, r)
        s.add(f'<circle cx="{px:.2f}" cy="{py:.2f}" r="0.65" fill="#d4af37"/>')
        left = n.startswith('OUT')
        s.text(px + (1.2 if left else -1.2), py + 0.4, n, 1.0, '#fff', anchor='start' if left else 'end', weight='bold')


def fuse_footprint(s):
    """Contorno da tampa do suporte e os 2 furos alargados (vista de cima)."""
    cx, cy = hp(*FUSE_C)
    s.add(f'<rect x="{cx - FUSE_MM[0] / 2:.2f}" y="{cy - FUSE_MM[1] / 2:.2f}" width="{FUSE_MM[0]}" height="{FUSE_MM[1]}" rx="0.5" fill="none" stroke="{PUR}" stroke-width="0.3" stroke-dasharray="0.9 0.5"/>')
    for name, (c, r) in FUSE_PINS.items():
        x, y = hp(c, r)
        s.add(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{FUSE_DRILL / 2 + 0.15:.2f}" fill="#fff" stroke="{PUR}" stroke-width="0.3"/>'
              f'<rect x="{x - 0.65:.2f}" y="{y - 0.2:.2f}" width="1.3" height="0.4" fill="{PUR}"/>')
        s.text(x + (1.6 if c == 1 else -1.6), y - 1.6, name, 0.95, RED if name == 'IN' else PUR, anchor='start' if c == 1 else 'end', weight='bold', bg=True)


def fuse_art(s):
    """Suporte AS-06 visto de cima: a tampa preta, com o fusível de vidro de 1,5 A dentro."""
    cx, cy = hp(*FUSE_C)
    s.add(f'<rect x="{cx - FUSE_MM[0] / 2:.2f}" y="{cy - FUSE_MM[1] / 2:.2f}" width="{FUSE_MM[0]}" height="{FUSE_MM[1]}" rx="0.8" fill="#212121" stroke="#000" stroke-width="0.3"/>')
    s.add(f'<rect x="{cx - 10:.2f}" y="{cy - 2.5:.2f}" width="20" height="5" rx="2.4" fill="#2f2f2f" stroke="#555" stroke-width="0.2"/>')
    s.text(cx, cy + 0.6, 'fusível 1,5 A (5 × 20)', 1.3, '#fff', weight='bold')
    s.text(cx - 11.6, cy + 0.45, 'OUT', 0.9, '#e1bee7', weight='bold')
    s.text(cx + 11.6, cy + 0.45, 'IN', 0.9, '#ffcdd2', weight='bold')


def bmp_header(s, labels):
    """Barra de 4 pinos macho do conector do BMP180 (vista de cima)."""
    xs = [hp(c, r)[0] for c, r in BMP_PINS.values()]
    _, y = hp(*BMP_PINS['SDA'])
    s.add(f'<rect x="{min(xs) - 1.27:.2f}" y="{y - 1.27:.2f}" width="{max(xs) - min(xs) + P:.2f}" height="{P:.2f}" rx="0.3" fill="#212121"/>')
    for n, (c, r) in BMP_PINS.items():
        x, _ = hp(c, r)
        s.add(f'<rect x="{x - 0.4:.2f}" y="{y - 0.4:.2f}" width="0.8" height="0.8" fill="#d4af37"/>')
        if labels:
            s.text(x, y - 1.9, n, 0.85, BMP_COL[n], weight='bold', bg=True)
    s.text((min(xs) + max(xs)) / 2, y + (2.6 if labels else -1.7), 'BMP180 (cabo)', 0.95, '#00838f', weight='bold', bg=True)


def view_top(stage, scale):
    s = Svg(W, H, scale)
    board(s)
    # antena: área fora da placa (lado esquerdo)
    s.add(f'<rect x="-6" y="{hp(1, 2)[1] - 7:.2f}" width="6" height="{hp(1, 12)[1] - hp(1, 2)[1] + 14:.2f}" fill="none" stroke="#9e9e9e" stroke-width="0.25" stroke-dasharray="0.8 0.6"/>')
    s.text(-3, hp(1, 7)[1], 'antena fica fora da placa', 1.1, '#757575', rotate=-90)
    if stage == 1:
        for name, col, pts in TRACKS:
            track(s, expand(pts), col, lambda x: x, width=0.45, opacity=0.45)
        for name, col, a, b in LINKS:
            track(s, [a, b], col, lambda x: x, width=0.45, opacity=0.45)
        header_footprint(s)
        for n, a, b, _ in RES:
            resistor(s, a, b, n)
        for name, col, pts, _ in JUMPERS:
            jumper(s, pts, col, name)
        for name, (c, r) in TJA_PINS.items():
            x, y = hp(c, r)
            s.add(f'<rect x="{x - 1.2:.2f}" y="{y - 1.2:.2f}" width="2.4" height="2.4" rx="0.3" fill="#212121"/><rect x="{x - 0.4:.2f}" y="{y - 0.4:.2f}" width="0.8" height="0.8" fill="#d4af37"/>')
            s.text(x + 1.8, y + 0.45, name, 1.0, {'VCC': RED, 'TX': RED, 'RX': YEL, 'GND': BLK}[name], anchor='start', weight='bold', bg=True)
        s.text(MX + 13.5 * P, MY + 19.5 * P, 'pinos do TJA1050', 1.15, '#1565c0', bg=True)
        pad_mark(s, *CAN_HOLES['CANH'], BLU, 'CANH', 'above', size=0.9)
        pad_mark(s, *CAN_HOLES['CANL'], BLU, 'CANL', 'below', size=0.9)
        for name, (c, r) in BUCK_PINS.items():
            x, y = hp(c, r)
            s.add(f'<rect x="{x - 1.2:.2f}" y="{y - 1.2:.2f}" width="2.4" height="2.4" rx="0.3" fill="#212121"/><rect x="{x - 0.4:.2f}" y="{y - 0.4:.2f}" width="0.8" height="0.8" fill="#d4af37"/>')
            s.text(x + (1.8 if c == 1 else -1.8), y + 0.45, name, 1.0, BUCK_COL[name], anchor='start' if c == 1 else 'end', weight='bold', bg=True)
        s.text(MX + 3.5 * P, hp(1, 19)[1], 'pinos do RT8272', 1.15, '#0d47a1', bg=True)
        bmp_header(s, labels=True)
        fuse_footprint(s)
        s.text(hp(*FUSE_C)[0], hp(*FUSE_C)[1] + 3.3, f'suporte do fusível: alargar 2 furos para {FUSE_DRILL:.1f} mm'.replace('.', ','), 1.0, PUR, weight='bold', bg=True)
        for pin, (c, r) in OBD_PADS.items():
            pad_mark(s, c, r, {'16': RED, '4': BLK, '5': BLK, '14': BLU}[pin], pin, 'below')
        s.text(hp(13, 24)[0] + 1.8, hp(13, 24)[1] + 2.9, '← cabo OBD', 1.2, '#5d4037', anchor='start')
        s.text(W / 2, H + 3.5, 'ETAPA 1 · vista de cima, antes de encaixar o ESP32 e os módulos', 1.7, '#5d4037', weight='bold')
    else:
        header_footprint(s)
        for n, a, b, _ in RES:
            resistor(s, a, b, n, show_label=False)
        for name, col, pts, _ in JUMPERS:
            jumper(s, pts, col, name)
        buck_art(s)
        fuse_art(s)
        tja_art(s)
        bmp_header(s, labels=False)
        esp32_art(s)
        for pin, (c, r) in OBD_PADS.items():
            x, y = hp(c, r)
            _, col, listra = OBD_WIRE[pin]
            # fio do cabo OBD saindo da placa, na cor do fio do cabo
            s.add(f'<path d="M{x:.2f},{y:.2f} L{x:.2f},{H + 4:.2f}" stroke="#37474f" stroke-width="1.1"/><path d="M{x:.2f},{y:.2f} L{x:.2f},{H + 4:.2f}" stroke="{col}" stroke-width="0.75"/>')
            if listra:
                s.add(f'<path d="M{x:.2f},{y:.2f} L{x:.2f},{H + 4:.2f}" stroke="{listra}" stroke-width="0.25" stroke-dasharray="1.2 0.8"/>')
            s.text(x, H + 5.4, pin, 1.3, '#37474f', weight='bold')
        s.text(hp(11, 24)[0] - 2, H + 5.4, 'cabo OBD:', 1.3, '#5d4037', anchor='end')
        s.text(W / 2, -3.4, 'ETAPA 2 · placa montada, vista de cima', 1.7, '#5d4037', weight='bold')
    return s.svg()


def view_bottom(scale):
    s = Svg(W, H, scale)
    X = board(s, mirror=True)
    for name, col, pts in TRACKS:
        track(s, expand(pts), col, X, width=1.05)
    for name, col, a, b in LINKS:
        track(s, [a, b], col, X, width=0.8)
    # suporte do fusível: 2 furos alargados para 1,5 mm com os pinos chatos
    for c, r in FUSE_PINS.values():
        x, y = hp(c, r)
        s.add(f'<circle cx="{X(x):.2f}" cy="{y:.2f}" r="{FUSE_DRILL / 2 + 0.15:.2f}" fill="#fff" stroke="{PUR}" stroke-width="0.3"/><circle cx="{X(x):.2f}" cy="{y:.2f}" r="0.6" fill="#9e9e9e" stroke="#616161" stroke-width="0.15"/>')
    # furos com perna de componente ou pino
    legs = set()
    for _, a, b, _ in RES:
        legs |= {a, b}
    for row in (2, 12):
        legs |= {(c, row) for c in range(2, 17)}
    legs |= set(BUCK_PINS.values()) | set(TJA_PINS.values()) | set(CAN_HOLES.values()) | set(BMP_PINS.values())
    for c, r in legs:
        x, y = hp(c, r)
        s.add(f'<circle cx="{X(x):.2f}" cy="{y:.2f}" r="0.55" fill="#9e9e9e" stroke="#616161" stroke-width="0.15"/>')
    for name, col, pts, _ in JUMPERS:
        for c, r in (pts[0], pts[-1]):
            if c != int(c):
                continue   # ponta soldada direto no pino do módulo, não num furo
            x, y = (MX + (c - 1) * P, MY + (r - 1) * P)
            s.add(f'<circle cx="{X(x):.2f}" cy="{y:.2f}" r="0.7" fill="none" stroke="{col}" stroke-width="0.35"/>')
            s.text(X(x) + (1.6 if c < 12 else -1.6), y + 0.45, name, 1.05, '#37474f', anchor='middle')
    for name, col, pts, _ in BOTTOM_WIRES:
        jumper(s, pts, col, name, X=X)
    # nomes das trilhas
    labels = {'GND': (9, 19.5, BLK), '5 V': (13, 18, RED), 'RX': (14, 21, YEL), 'CAN-L': (18, 23.5, BLU), 'CANH': (18, 18.5, BLU), '12 V com fusível': (7.2, 20.5, PUR),
              'OUT+': (2, 18, RED), 'fusível': (FUSE_C[0], FUSE_C[1] + 1.3, PUR), '12 V': (10, 25.2, RED),
              'D21': (6.5, 1.0, YEL), '3V3': (16.5, 1.0, ORG), 'BMP180': (13.5, 17.9, CYA)}
    for t, (c, r, col) in labels.items():
        x, y = MX + (c - 1) * P, MY + (r - 1) * P
        s.text(X(x), y + 0.5, t, 1.25, col, weight='bold', bg=True)
    for n, a, b, _ in RES:
        (x1, y1), (x2, y2) = hp(*a), hp(*b)
        s.text(X((x1 + x2) / 2), (y1 + y2) / 2 + 0.5, n, 1.2, '#616161', bg=True)
    s.text(W / 2, hp(1, 7)[1], 'barras do ESP32 nas linhas 2 e 12', 1.2, '#757575', bg=True)
    s.text(W / 2, H + 3.5, 'VISTA DE BAIXO · lado da solda (espelhada)', 1.7, '#5d4037', weight='bold')
    return s.svg()


def schematic():
    s = Svg(150, 78, 1.6, pad=3)
    s.add('<rect x="-3" y="-3" width="156" height="84" fill="#fff"/>')

    def box(x, y, w, h, title, color, pins):
        s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="1.5" fill="#fafafa" stroke="{color}" stroke-width="0.5"/>')
        s.text(x + w / 2, y + 3.2, title, 2.4, color, weight='bold')
        pos = {}
        for name, side, k in pins:
            px = x if side == 'L' else x + w
            py = y + 7 + k * 4.5
            s.add(f'<circle cx="{px}" cy="{py}" r="0.7" fill="{color}"/>')
            s.text(px + (1.5 if side == 'L' else -1.5), py + 0.6, name, 1.8, '#37474f', anchor='start' if side == 'L' else 'end')
            pos[name] = (px, py)
        return pos

    obd = box(2, 18, 18, 30, 'OBD', BLK, [('16 +12 V', 'R', 0), ('4 chassi', 'R', 1.5), ('5 sinal', 'R', 3), ('14 CAN-L', 'R', 4.5)])
    buck = box(38, 4, 26, 18, 'RT8272 (5,0 V)', GRN, [('IN+', 'L', 0), ('IN−', 'L', 2), ('OUT+', 'R', 0), ('OUT−', 'R', 2)])
    esp = box(88, 4, 28, 34, 'ESP32 DevKit', '#283593', [('VIN', 'L', 0), ('GND', 'L', 1.5), ('3V3', 'L', 3), ('D21', 'L', 5), ('D25', 'R', 2), ('D26', 'R', 3)])
    bmp = box(126, 8, 21, 30, 'BMP180', CYA, [('SDA', 'L', 0.6), ('SCL', 'L', 1.6), ('VCC', 'L', 3), ('GND', 'L', 4)])
    tja = box(38, 40, 26, 28, 'TJA1050', BLU, [('VCC', 'R', 0), ('TX', 'R', 1), ('GND', 'R', 2), ('RX', 'R', 3), ('CANH', 'L', 3.5), ('CANL', 'L', 4.6)])

    def line(pts, col, w=0.55):
        d = ' '.join(f'{"M" if i == 0 else "L"}{x:.2f},{y:.2f}' for i, (x, y) in enumerate(pts))
        s.add(f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linejoin="round"/>')

    def dot(x, y, col):
        s.add(f'<circle cx="{x}" cy="{y}" r="0.9" fill="{col}"/>')

    # 12 V → fusível → IN+
    x16, y16 = obd['16 +12 V']
    line([(x16, y16), (26, y16), (26, buck['IN+'][1]), buck['IN+']], RED)
    s.add(f'<rect x="{24.5}" y="{(y16 + buck["IN+"][1]) / 2 - 3}" width="3" height="6" rx="1" fill="#fff" stroke="{PUR}" stroke-width="0.5"/>')
    s.text(28.5, (y16 + buck['IN+'][1]) / 2 + 0.6, 'fusível 1,5 A (na placa)', 1.7, PUR, anchor='start', weight='bold')
    # GND comum: 4, 5, IN−, OUT−, GND ESP32, GND TJA
    gy = 36
    x4, y4 = obd['4 chassi']
    x5, y5 = obd['5 sinal']
    line([(x4, y4), (30, y4), (30, gy)], BLK)
    line([(x5, y5), (30, y5)], BLK)
    line([buck['IN−'], (34, buck['IN−'][1]), (34, gy)], BLK)
    line([(30, gy), (80, gy)], BLK)
    line([buck['OUT−'], (72, buck['OUT−'][1]), (72, gy)], BLK)
    line([esp['GND'], (80, esp['GND'][1]), (80, gy)], BLK)
    line([tja['GND'], (72, tja['GND'][1]), (72, gy)], BLK)
    for p in ((30, y5), (34, gy), (72, gy), (30, gy)):
        dot(*p, BLK)
    s.text(55, gy - 1.0, 'GND', 1.8, BLK, weight='bold')
    # 5 V: OUT+ → VIN, VCC e TX do TJA
    line([buck['OUT+'], (76, buck['OUT+'][1]), esp['VIN']], RED)
    line([(76, buck['OUT+'][1]), (76, tja['VCC'][1]), tja['VCC']], RED)
    line([tja['TX'], (70, tja['TX'][1]), (70, tja['VCC'][1])], RED)
    dot(76, buck['OUT+'][1], RED)
    dot(70, tja['VCC'][1], RED)
    s.text(51, 73, 'TX preso no 5 V: o transceptor nunca transmite', 1.6, RED)
    # RX → R1 → D21 → R2 → R3 → GND
    rx = tja['RX']
    line([rx, (84, rx[1]), (84, esp['D21'][1]), esp['D21']], YEL)
    s.add(f'<rect x="{75}" y="{rx[1] - 1.2}" width="6" height="2.4" fill="#fff" stroke="#8d6e63" stroke-width="0.4"/>')
    s.text(78, rx[1] - 1.8, 'R1 1 kΩ', 1.6, '#5d4037')
    dot(84, esp['D21'][1], YEL)
    line([(84, esp['D21'][1]), (84, 41), (100, 41), (100, 50)], YEL)
    for i, ry in enumerate((51, 58)):
        s.add(f'<rect x="98.8" y="{ry}" width="2.4" height="5" fill="#fff" stroke="#8d6e63" stroke-width="0.4"/>')
        s.text(103, ry + 3.0, f'R{2 + i} 1 kΩ', 1.6, '#5d4037', anchor='start')
    line([(100, 50), (100, 51)], YEL)
    line([(100, 56), (100, 58)], YEL)
    line([(100, 63), (100, 66), (106, 66)], BLK)
    s.text(107, 66.6, 'GND', 1.6, BLK, anchor='start')
    s.text(102, 45, 'divisor 5 V → 3,3 V', 1.5, '#5d4037', anchor='start')
    # CANH → R4 → 3V3
    ch = tja['CANH']
    line([ch, (33, ch[1]), (33, 69), (90, 69), (90, esp['3V3'][1]), esp['3V3']], ORG)
    s.add(f'<rect x="{70}" y="{67.8}" width="6" height="2.4" fill="#fff" stroke="#8d6e63" stroke-width="0.4"/>')
    s.text(73, 67.2, 'R4 1 kΩ (CANH em 3,3 V)', 1.6, '#5d4037')
    # CAN-L
    x14, y14 = obd['14 CAN-L']
    line([(x14, y14), (28, y14), (28, tja['CANL'][1]), tja['CANL']], BLU)
    # BMP180 no cabo: SDA no D25, SCL no D26, VCC no 5 V (regulador do GY-68)
    line([esp['D25'], (121, esp['D25'][1]), (121, bmp['SDA'][1]), bmp['SDA']], CYA)
    line([esp['D26'], (123, esp['D26'][1]), (123, bmp['SCL'][1]), bmp['SCL']], GRN)
    for pin, txt, col in (('VCC', '5 V', RED), ('GND', 'GND', BLK)):
        x, y = bmp[pin]
        line([(x - 6, y), (x, y)], col)
        s.text(x - 6.5, y + 0.6, txt, 1.6, col, anchor='end', weight='bold')
    s.text(136.5, 44, 'no cabo, longe do calor', 1.5, '#5d4037')
    s.text(75, 1, 'Esquema de ligação (fora de escala)', 2.0, '#5d4037', weight='bold')
    return s.svg()


if __name__ == '__main__':
    files = {
        'esquema.svg': schematic(),
        'etapa1.svg': view_top(1, 2.4), 'etapa2.svg': view_top(2, 2.4), 'baixo.svg': view_bottom(2.4),
        'etapa1-real.svg': view_top(1, 1), 'etapa2-real.svg': view_top(2, 1), 'baixo-real.svg': view_bottom(1),
    }
    for name, text in files.items():
        with open(os.path.join(OUT, name), 'w', encoding='utf-8') as fh:
            fh.write(text)
    for old in ('cima.svg', 'cima-2x.svg', 'baixo-2x.svg'):
        p = os.path.join(OUT, old)
        if os.path.exists(p):
            os.remove(p)
    print('ok:', ', '.join(files))
    import gerar_3d   # modelo 3D com as mesmas posições
    gerar_3d.main()
