#!/usr/bin/env python3
"""PCB definitiva (duas faces, KiCad 9) da escuta CAN do Uno Vivace, versão TJA1050: mesmo circuito da placa ilhada.

Fonte da verdade: ../placa/gerar_placa.py (posições na grade de 2,54 mm e ligações), ../placa/gerar_3d.py (alturas e
medidas dos módulos) e ../placa/caixa.py (placa de 50 x 70 mm apoiada nos 4 cantos). Este script gera, sem interface
gráfica:
  - escuta_can.kicad_sym, escuta_can.pretty/ e escuta_can.3dshapes/ (biblioteca do projeto, medidas reais);
  - escuta-can-uno.kicad_pro, .kicad_sch, .kicad_pcb e .kicad_dru (regras: sinal >= 0,25 mm, alimentação >= 0,6 mm,
    folga >= 0,2 mm; plano de GND embaixo com costura de vias);
  - roda o ERC e o DRC (com paridade) e para se sobrar qualquer violação;
  - fabricacao/: Gerber + furação (zip), BOM.csv, CPL.csv, esquemático em PDF, SVG das duas faces, STEP e PNG 3D.

Uso (KiCad 9 com o módulo pcbnew):
    python3 veiculos/fiat-uno-vivace-2012/placa-pcb/gerar_kicad.py

Diferenças de posição em relação à placa ilhada (o circuito é o mesmo): o C1 desce uma linha (linha 20), para o
pátio dele não encostar no R6, e o TP3 vai para (10, 16), porque a trilha do 5 V passa na linha 13. As trilhas são
fixas: não há pontes nem fios por cima.
"""
import csv
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import zipfile

AQUI = os.path.dirname(os.path.abspath(__file__))
PLACA = os.path.normpath(os.path.join(AQUI, '..', 'placa'))
sys.path.insert(0, PLACA)
os.environ['PLACA_VARIANTE'] = 'tja'
import gerar_placa as gp   # noqa: E402  (posições da placa ilhada, versão TJA1050)
import caixa               # noqa: E402  (só para conferir o tamanho da placa e os apoios)

PROJ = 'escuta-can-uno'
LIB = 'escuta_can'
FAB = os.path.join(AQUI, 'fabricacao')
P = gp.P
W, H = gp.W, gp.H
assert (W, H) == (50.0, 70.0) and caixa.APOIO == 3.5
OX, OY = 100.0, 100.0        # origem da placa no KiCad (canto de cima à esquerda)
APOIO = caixa.APOIO          # apoios da caixa nos 4 cantos: sem cobre
T = 1.6

# Alturas (mm) do gerar_3d.py
FEM_H = 8.3        # barra fêmea
MALE_H = 2.5       # plástico da barra macho
MOD_Z = FEM_H + MALE_H   # fundo do ESP32, do TJA1050 e do RT8272, acima da face de cima da PCB
ESP_T, MOD_T = 1.5, 1.6


def uid(*partes):
    """UUID fixo (o mesmo a cada geração), derivado do nome."""
    h = hashlib.md5('/'.join(map(str, partes)).encode()).hexdigest()
    return f'{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}'


def g(c, r):
    """Furo (coluna, linha) da grade → mm na placa (canto de cima à esquerda = 0, 0)."""
    return gp.hp(c, r)


# ======================================================================= circuito (o da placa ilhada, versão TJA1050)
# Redes globais (nomes dos rótulos do esquemático = nomes das redes da PCB)
POWER = ['12V', '12V_FUS', '5V', '3V3', 'GND']

ESP_NET = {'D21': 'CAN_RX_3V3', 'GND': 'GND', '3V3': '3V3', 'VIN': '5V', 'D34': 'VBAT_ADC', 'D25': 'SDA', 'D26': 'SCL',
           'D18': 'LED_COM', 'TX2': 'LED_R', 'RX2': 'LED_G', 'D4': 'LED_B'}

# Peças: ref → (símbolo, valor, footprint, {pino: rede}, posição do pino 1 (c, r), posição do pino 2 ou None, extra)
# A posição define a colocação; o ângulo sai do pino 1 → pino 2.
POS_C1 = ((5, 20), (7, 20))
POS_RES = {'R5': ((4, 21), (4, 17))}   # R5 uma linha acima: o pátio dele encostava no do porta-fusível
POS_TP = {'TP1': (11, 23), 'TP2': (16, 14), 'TP3': (10, 16), 'TP4': (10, 21)}

PARTS = []


def part(ref, sym, value, fp, pins, at, at2=None, desc=''):
    desc = desc.replace('"', "'")
    PARTS.append(dict(ref=ref, sym=sym, value=value, fp=fp, pins=pins, at=at, at2=at2, desc=desc))


esp_pins = {}
for i, n in enumerate(gp.ESP_TOP):
    esp_pins[str(i + 1)] = (n, ESP_NET.get(n))
for i, n in enumerate(gp.ESP_BOT):
    esp_pins[str(i + 16)] = (n, ESP_NET.get(n))
part('U1', 'ESP32_DevKit_V1', 'ESP32 DevKit V1 (30 pinos)', 'ESP32_DevKit_V1_30P_Socket', esp_pins, (2, 2), (16, 2),
     'ESP32 DevKit V1 em duas barras fêmea de 15 pinos (fileiras a 25,4 mm), antena para fora da placa à esquerda, USB à direita')
part('U2', 'TJA1050_Module', 'TJA1050 (módulo, só escuta)', 'TJA1050_Module_Socket',
     {'1': ('VCC', '5V'), '2': ('TXD', '5V'), '3': ('RXD', 'CAN_RX_5V'), '4': ('GND', 'GND')},
     gp.TJA_PINS['VCC'], gp.TJA_PINS['GND'], 'Módulo TJA1050 22 x 11 mm em barra fêmea de 4 pinos; TXD preso em 5 V (nunca transmite)')
part('U3', 'RT8272_Module', 'RT8272 HW-108 (12 V → 5 V)', 'RT8272_HW108_Socket',
     {'1': ('EN', None), '2': ('IN-', 'GND'), '3': ('IN+', '12V_FUS'), '4': ('OUT-', 'GND'), '5': ('OUT+', '5V')},
     gp.BUCK_PINS['EN'], gp.BUCK_PINS['IN+'], 'Step-down RT8272 (HW-108) 21 x 21 mm, regulado em 5,0 V; EN sem ligação')
part('F1', 'Fuse', '1,5 A (vidro 5 x 20 mm)', 'Fuseholder_AS06_5x20_P20.32',
     {'1': ('IN', '12V'), '2': ('OUT', '12V_FUS')}, gp.FUSE_PINS['IN'], gp.FUSE_PINS['OUT'],
     'Porta-fusível AS-06 com tampa, pinos chatos de 1,3 x 0,4 mm a 20,32 mm (furo de 1,5 mm)')
part('J1', 'OBD_Pigtail', 'Cabo OBD2 macho (fios 16, 4, 5, 14)', 'OBD_Pigtail_4W',
     {'16': ('+12V', '12V'), '4': ('GND_CH', 'GND'), '5': ('GND_SIG', 'GND'), '14': ('CAN-L', 'CANL')},
     gp.OBD_PADS['16'], gp.OBD_PADS['4'], 'Fios soldados: 16 (+12 V), 4 e 5 (GND), 14 (CAN-L do painel). O pino 6 fica sem ligação')
part('J2', 'Conn_01x02', 'CANH/CANL do TJA1050 (fios)', 'PinHeader_1x02_H',
     {'1': ('CANH', 'CANH'), '2': ('CANL', 'CANL')}, gp.CAN_HOLES['CANH'], gp.CAN_HOLES['CANL'],
     'Barra macho de 2 pinos: fios curtos do CANH e do CANL do módulo TJA1050 (Dupont fêmea)')
SENS = {'SDA': 'SDA', 'SCL': 'SCL', 'GND': 'GND', 'VCC': '5V'}
for ref, nome, pins in (('J3', 'GY-273 (bússola)', gp.MAG_PINS), ('J4', 'LSM6DS3 (acel./giro)', gp.LSM_PINS),
                        ('J5', 'BMP180 (pressão)', gp.BMP_PINS)):
    part(ref, 'Conn_01x04', nome, 'PinHeader_1x04_H',
         {str(i + 1): (k, SENS[k]) for i, k in enumerate(['SDA', 'SCL', 'GND', 'VCC'])}, pins['SDA'], pins['SCL'],
         f'Cabo do sensor {nome}: SDA, SCL, GND, VCC (5 V; o módulo tem regulador)')
part('J6', 'Conn_01x05', 'LED tricolor (opcional)', 'PinHeader_1x05_H',
     {'1': ('COM', 'LED_COM'), '2': ('NC', None), '3': ('R', 'LED_R'), '4': ('G', 'LED_G'), '5': ('B', 'LED_B')},
     gp.LED_HEADER[0], gp.LED_HEADER[1], 'LED RGB: comum no D18, vermelho no TX2, verde no RX2, azul no D4 (resistores nas pernas)')
RES_NET = {'R1': ('CAN_RX_3V3', 'CAN_RX_5V'), 'R2': ('CAN_RX_3V3', 'RX_DIV'), 'R3': ('RX_DIV', 'GND'),
           'R4': ('3V3', 'CANH'), 'R5': ('12V_FUS', 'VBAT_ADC'), 'R6': ('VBAT_ADC', 'GND')}
RES_VAL = {'R5': '100k', 'R6': '20k'}
for nome, a, b, desc in gp.RES:
    n1, n2 = RES_NET[nome]
    a, b = POS_RES.get(nome, (a, b))
    part(nome, 'R', RES_VAL.get(nome, '1k'), 'R_Axial_DIN0207_P10.16mm', {'1': ('~', n1), '2': ('~', n2)}, a, b, desc)
part('C1', 'C', '100n', 'C_Disc_D5.0mm_P5.08mm', {'1': ('~', 'VBAT_ADC'), '2': ('~', 'GND')}, *POS_C1,
     '100 nF cerâmico ("104"): filtro do divisor da bateria')
TP_NET = {'12 V': '12V_FUS', '5 V': '5V', 'GND': 'GND'}
for nome, rot, _, _, desc in gp.TEST_POINTS:
    part(nome, 'TestPoint', rot, 'TestPoint_Keystone_5000', {'1': ('TP', TP_NET[rot])}, POS_TP[nome], None, desc)

PAD_REF = {'U1': ('1', '15'), 'U2': ('1', '4'), 'U3': ('1', '3'), 'J1': ('16', '4')}   # pads que caem em at e at2
NETS = sorted({n for p in PARTS for _, n in p['pins'].values() if n})


# ======================================================================= biblioteca: símbolos
def fnt(size=1.27, extra=''):
    return f'(effects (font (size {size} {size})){extra})'


SYMS = {}   # nome → (prefixo, [(num, nome, lado)], largura, altura)


def sym_def(nome, prefix, left, right, width=10.16):
    SYMS[nome] = (prefix, left, right, width)


sym_def('ESP32_DevKit_V1', 'U', [(str(i + 1), n) for i, n in enumerate(gp.ESP_TOP)],
        [(str(i + 16), n) for i, n in enumerate(gp.ESP_BOT)], 15.24)
sym_def('TJA1050_Module', 'U', [('1', 'VCC'), ('2', 'TXD'), ('3', 'RXD'), ('4', 'GND')], [], 12.7)
sym_def('RT8272_Module', 'U', [('1', 'EN'), ('2', 'IN-'), ('3', 'IN+')], [('4', 'OUT-'), ('5', 'OUT+')], 12.7)
sym_def('OBD_Pigtail', 'J', [('16', '+12V'), ('4', 'GND_CH'), ('5', 'GND_SIG'), ('14', 'CAN-L')], [], 12.7)
sym_def('Conn_01x02', 'J', [('1', 'Pin_1'), ('2', 'Pin_2')], [], 5.08)
sym_def('Conn_01x04', 'J', [(str(i), f'Pin_{i}') for i in range(1, 5)], [], 5.08)
sym_def('Conn_01x05', 'J', [(str(i), f'Pin_{i}') for i in range(1, 6)], [], 5.08)
sym_def('R', 'R', [('1', '~')], [('2', '~')], 5.08)
sym_def('C', 'C', [('1', '~')], [('2', '~')], 5.08)
sym_def('Fuse', 'F', [('1', '~')], [('2', '~')], 5.08)
sym_def('TestPoint', 'TP', [('1', '1')], [], 2.54)


def sym_pins(nome):
    """Pinos do símbolo: [(num, nome, x, y, ângulo)] no sistema do símbolo (y para cima)."""
    _, left, right, w = SYMS[nome]
    n = max(len(left), len(right), 1)
    out = []
    for lado, lst in ((0, left), (1, right)):
        for i, (num, pn) in enumerate(lst):
            y = ((n - 1) / 2 - i) * 2.54
            y = round(y / 1.27) * 1.27
            x = -(w / 2 + 2.54) if lado == 0 else (w / 2 + 2.54)
            out.append((num, pn, round(x, 2), round(y, 2), 0 if lado == 0 else 180))
    return out


def sym_body(nome):
    _, left, right, w = SYMS[nome]
    n = max(len(left), len(right), 1)
    h = n * 2.54
    return w, h


def sym_text(nome, full):
    prefix, *_ = SYMS[nome]
    w, h = sym_body(nome)
    hide_names = nome in ('R', 'C', 'Fuse', 'TestPoint')
    s = [f'(symbol "{full}"']
    if hide_names:
        s.append('(pin_names (offset 0) (hide yes))')
    else:
        s.append('(pin_names (offset 1.016))')
    s.append('(exclude_from_sim no) (in_bom yes) (on_board yes)')
    s.append(f'(property "Reference" "{prefix}" (at 0 {h / 2 + 1.27:.2f} 0) {fnt()})')
    s.append(f'(property "Value" "{nome}" (at 0 {-h / 2 - 1.27:.2f} 0) {fnt()})')
    s.append(f'(property "Footprint" "" (at 0 0 0) {fnt(extra=" (hide yes)")})')
    s.append(f'(property "Datasheet" "" (at 0 0 0) {fnt(extra=" (hide yes)")})')
    s.append(f'(property "Description" "" (at 0 0 0) {fnt(extra=" (hide yes)")})')
    s.append(f'(symbol "{nome}_0_1" (rectangle (start {-w / 2:.2f} {h / 2:.2f}) (end {w / 2:.2f} {-h / 2:.2f}) '
             f'(stroke (width 0.254) (type default)) (fill (type background))))')
    pins = ' '.join(f'(pin passive line (at {x} {y} {a}) (length 2.54) (name "{pn}" {fnt()}) (number "{num}" {fnt()}))'
                    for num, pn, x, y, a in sym_pins(nome))
    s.append(f'(symbol "{nome}_1_1" {pins})')
    s.append('(embedded_fonts no))')
    return ' '.join(s)


def write_symbol_lib():
    body = '\n'.join(sym_text(n, n) for n in SYMS)
    with open(os.path.join(AQUI, f'{LIB}.kicad_sym'), 'w') as f:
        f.write(f'(kicad_symbol_lib (version 20241209) (generator "gerar_kicad") (generator_version "9.0")\n{body}\n)\n')


# ======================================================================= biblioteca: footprints e modelos 3D
MOD3D = '${KICAD9_3DMODEL_DIR}'
FPS = {}


def r2(v):
    return round(v + 0.0, 4)


class Fp:
    """Footprint escrito em S-expression (coordenadas do footprint: mm, y para baixo, origem no pino 1)."""

    def __init__(self, nome, descr, ref_at=(0, -2.0), val_at=(0, 2.0), ref_size=1.0):
        self.nome, self.descr = nome, descr
        self.ref_at, self.val_at, self.ref_size = ref_at, val_at, ref_size
        self.items, self.models = [], []

    def pad(self, num, x, y, d, drill, square=False):
        shape = 'rect' if square else 'circle'
        self.items.append(f'(pad "{num}" thru_hole {shape} (at {r2(x)} {r2(y)}) (size {d} {d}) (drill {drill}) '
                          f'(layers "*.Cu" "*.Mask") (remove_unused_layers no))')

    def rect(self, layer, x0, y0, x1, y1, w=0.1):
        self.items.append(f'(fp_rect (start {r2(x0)} {r2(y0)}) (end {r2(x1)} {r2(y1)}) (stroke (width {w}) (type solid)) '
                          f'(fill no) (layer "{layer}"))')

    def poly(self, layer, pts, w=0.05):
        xy = ' '.join(f'(xy {r2(x)} {r2(y)})' for x, y in pts)
        self.items.append(f'(fp_poly (pts {xy}) (stroke (width {w}) (type solid)) (fill no) (layer "{layer}"))')

    def text(self, layer, x, y, t, size=0.8):
        self.items.append(f'(fp_text user "{t}" (at {r2(x)} {r2(y)} 0) (layer "{layer}") '
                          f'(effects (font (size {size} {size}) (thickness {round(size * 0.15, 3)}))))')

    def model(self, path, off=(0, 0, 0), rot=0):
        self.models.append(f'(model "{path}" (offset (xyz {r2(off[0])} {r2(-off[1])} {r2(off[2])})) '
                           f'(scale (xyz 1 1 1)) (rotate (xyz 0 0 {rot})))')

    def text_sexpr(self):
        rs = self.ref_size
        s = [f'(footprint "{self.nome}" (version 20241229) (generator "gerar_kicad") (generator_version "9.0") (layer "F.Cu")',
             f'(descr "{self.descr}") (tags "escuta CAN Uno")',
             f'(property "Reference" "REF**" (at {self.ref_at[0]} {self.ref_at[1]} 0) (layer "F.SilkS") '
             f'(effects (font (size {rs} {rs}) (thickness {round(rs * 0.15, 3)}))))',
             f'(property "Value" "{self.nome}" (at {self.val_at[0]} {self.val_at[1]} 0) (layer "F.Fab") '
             f'(effects (font (size 1 1) (thickness 0.15))))',
             '(property "Datasheet" "" (at 0 0 0) (layer "F.Fab") (hide yes) (effects (font (size 1 1) (thickness 0.15))))',
             '(property "Description" "" (at 0 0 0) (layer "F.Fab") (hide yes) (effects (font (size 1 1) (thickness 0.15))))',
             '(attr through_hole)']
        s += self.items + self.models + ['(embedded_fonts no))']
        return '\n'.join(s) + '\n'


def courtyard_rows(fp, pads, m=1.0):
    """Pátio: um retângulo em volta de cada fileira contínua de pads."""
    xs = [x for x, _ in pads]
    ys = [y for _, y in pads]
    fp.rect('F.CrtYd', min(xs) - m, min(ys) - m, max(xs) + m, max(ys) + m, 0.05)


# ----------------------------------------------------------------- modelos 3D próprios (caixas com as medidas reais)
BOXES = {}   # nome do modelo → [(cor RGB, x0, y0, z0, sx, sy, sz)] em coordenadas 3D (mm, y para cima, z a partir da PCB)


def box3(model, col, x0, y0, z0, sx, sy, sz):
    """Caixa a partir de coordenadas do footprint (y para baixo): converte para o 3D (y para cima)."""
    BOXES.setdefault(model, []).append((col, x0, -(y0 + sy), z0, sx, sy, sz))


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def write_wrl(path, boxes):
    """VRML 2.0 da KiCad: 1 unidade = 0,1 polegada (2,54 mm)."""
    k = 1 / 2.54
    out = ['#VRML V2.0 utf8']
    for col, x0, y0, z0, sx, sy, sz in boxes:
        r, g_, b = hexrgb(col)
        v = [(x0 + dx * sx, y0 + dy * sy, z0 + dz * sz) for dz in (0, 1) for dy in (0, 1) for dx in (0, 1)]
        pts = ', '.join(f'{x * k:.4f} {y * k:.4f} {z * k:.4f}' for x, y, z in v)
        faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
        idx = ', '.join(f'{a}, {b2}, {c}, {d}, -1' for a, b2, c, d in faces)
        out.append(f'Shape {{ appearance Appearance {{ material Material {{ diffuseColor {r:.3f} {g_:.3f} {b:.3f} '
                   f'specularColor 0.2 0.2 0.2 shininess 0.3 }} }} geometry IndexedFaceSet {{ solid TRUE '
                   f'coord Coordinate {{ point [ {pts} ] }} coordIndex [ {idx} ] }} }}')
    open(path, 'w').write('\n'.join(out) + '\n')


def write_step(path, nome, boxes):
    """STEP AP214 (ISO 10303-21) com um sólido B-rep por caixa: o modelo mecânico de cada módulo."""
    ents = []

    def e(txt):
        ents.append(txt)
        return f'#{len(ents)}'

    ctx_app = e("APPLICATION_CONTEXT('automotive design')")
    e(f"APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,{ctx_app})")
    prod_ctx = e(f"PRODUCT_CONTEXT('',{ctx_app},'mechanical')")
    prod = e(f"PRODUCT('{nome}','{nome}','',({prod_ctx}))")
    pdf = e(f"PRODUCT_DEFINITION_FORMATION('','',{prod})")
    pd_ctx = e(f"PRODUCT_DEFINITION_CONTEXT('part definition',{ctx_app},'design')")
    pdef = e(f"PRODUCT_DEFINITION('design','',{pdf},{pd_ctx})")
    e(f"PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,({prod}))")
    pds = e(f"PRODUCT_DEFINITION_SHAPE('','',{pdef})")
    lu = e("(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))")
    au = e("(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))")
    su = e("(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())")
    unc = e(f"UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),{lu},'distance_accuracy_value','confusion accuracy')")
    gctx = e(f"(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT(({unc})) "
             f"GLOBAL_UNIT_ASSIGNED_CONTEXT(({lu},{au},{su})) REPRESENTATION_CONTEXT('Context3D','3D context'))")
    org = e("CARTESIAN_POINT('',(0.,0.,0.))")
    dz = e("DIRECTION('',(0.,0.,1.))")
    dx = e("DIRECTION('',(1.,0.,0.))")
    ax0 = e(f"AXIS2_PLACEMENT_3D('',{org},{dz},{dx})")

    def f(v):
        return f'{v:.6f}'.rstrip('0').rstrip('.') + ('.' if '.' not in f'{v:.6f}'.rstrip('0').rstrip('.') else '')

    solids = []
    faces_def = [((0, 2, 3, 1), (0, 0, -1)), ((4, 5, 7, 6), (0, 0, 1)), ((0, 1, 5, 4), (0, -1, 0)),
                 ((2, 6, 7, 3), (0, 1, 0)), ((0, 4, 6, 2), (-1, 0, 0)), ((1, 3, 7, 5), (1, 0, 0))]
    for col, x0, y0, z0, sx, sy, sz in boxes:
        v = [(x0 + ddx * sx, y0 + ddy * sy, z0 + ddz * sz) for ddz in (0, 1) for ddy in (0, 1) for ddx in (0, 1)]
        cp = [e(f"CARTESIAN_POINT('',({f(x)},{f(y)},{f(z)}))") for x, y, z in v]
        vp = [e(f"VERTEX_POINT('',{c})") for c in cp]
        edges = {}

        def edge(a, b):
            key = (min(a, b), max(a, b))
            if key not in edges:
                i, j = key
                d = [v[j][k] - v[i][k] for k in range(3)]
                ln = math.sqrt(sum(t * t for t in d))
                dd = e(f"DIRECTION('',({f(d[0] / ln)},{f(d[1] / ln)},{f(d[2] / ln)}))")
                vec = e(f"VECTOR('',{dd},{f(ln)})")
                line = e(f"LINE('',{cp[i]},{vec})")
                edges[key] = e(f"EDGE_CURVE('',{vp[i]},{vp[j]},{line},.T.)")
            return edges[key], a < b

        fcs = []
        for loop, n in faces_def:
            oes = []
            for a, b in zip(loop, loop[1:] + loop[:1]):
                ec, fwd = edge(a, b)
                oes.append(e(f"ORIENTED_EDGE('',*,*,{ec},{'.T.' if fwd else '.F.'})"))
            el = e(f"EDGE_LOOP('',({','.join(oes)}))")
            fb = e(f"FACE_OUTER_BOUND('',{el},.T.)")
            p0, p1 = v[loop[0]], v[loop[1]]
            d = [p1[k] - p0[k] for k in range(3)]
            ln = math.sqrt(sum(t * t for t in d))
            nd = e(f"DIRECTION('',({f(n[0])},{f(n[1])},{f(n[2])}))")
            rd = e(f"DIRECTION('',({f(d[0] / ln)},{f(d[1] / ln)},{f(d[2] / ln)}))")
            ax = e(f"AXIS2_PLACEMENT_3D('',{cp[loop[0]]},{nd},{rd})")
            pl = e(f"PLANE('',{ax})")
            fcs.append(e(f"ADVANCED_FACE('',({fb}),{pl},.T.)"))
        sh = e(f"CLOSED_SHELL('',({','.join(fcs)}))")
        solids.append(e(f"MANIFOLD_SOLID_BREP('{nome}',{sh})"))
    rep = e(f"ADVANCED_BREP_SHAPE_REPRESENTATION('{nome}',({','.join(solids + [ax0])}),{gctx})")
    e(f"SHAPE_DEFINITION_REPRESENTATION({pds},{rep})")
    head = ("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('modelo do modulo'),'2;1');\n"
            f"FILE_NAME('{nome}.step','2026-11-26T00:00:00',('gerar_kicad'),(''),'gerar_kicad','gerar_kicad','');\n"
            "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n")
    data = '\n'.join(f'#{i + 1}={t};' for i, t in enumerate(ents))
    open(path, 'w').write(head + data + '\nENDSEC;\nEND-ISO-10303-21;\n')


def own_model(fp, nome):
    fp.model(f'${{KIPRJMOD}}/{LIB}.3dshapes/{nome}.wrl')


# ----------------------------------------------------------------- ESP32 DevKit V1 em duas barras fêmea 1x15
def fp_esp():
    fp = Fp('ESP32_DevKit_V1_30P_Socket', 'ESP32 DevKit V1 de 30 pinos (50 x 28 mm, paquimetro) em duas barras femea 1x15, fileiras a 25,4 mm',
            ref_at=(-4.2, 12.7), val_at=(17.78, 22.0), ref_size=1.0)
    top = [(i * P, 0) for i in range(15)]
    bot = [(i * P, 10 * P) for i in range(15)]
    for i, (x, y) in enumerate(top):
        fp.pad(str(i + 1), x, y, 1.7, 1.0, square=(i == 0))
    for i, (x, y) in enumerate(bot):
        fp.pad(str(i + 16), x, y, 1.7, 1.0)
    for row in (top, bot):
        courtyard_rows(fp, row, 0.95)
    cx, cy = 7 * P, 5 * P
    x0, y0 = cx - gp.ESP_L / 2, cy - gp.ESP_W / 2
    fp.rect('F.Fab', x0, y0, x0 + gp.ESP_L, y0 + gp.ESP_W, 0.1)
    fp.text('F.Fab', cx, cy, 'ESP32 DevKit V1', 1.2)
    for off in (0, 10 * P):
        fp.model(f'{MOD3D}/Connector_PinSocket_2.54mm.3dshapes/PinSocket_1x15_P2.54mm_Vertical.step', (0, off, 0), -90)
    own_model(fp, 'ESP32_DevKit_V1')
    m = 'ESP32_DevKit_V1'
    for off in (0, 10 * P):   # barras macho do ESP32 (plástico de 2,5 mm) sobre as fêmeas
        box3(m, '#111111', -P / 2, off - P / 2, FEM_H, 15 * P, P, MALE_H)
    box3(m, '#1a237e', x0, y0, MOD_Z, gp.ESP_L, gp.ESP_W, ESP_T)
    zt = MOD_Z + ESP_T
    box3(m, '#263238', x0 + 1.0, cy - 9, zt, 25.5, 18, 0.8)            # módulo WROOM-32 (antena à esquerda)
    box3(m, '#b0bec5', x0 + 7.5, cy - 8, zt + 0.8, 18, 16, 2.2)        # blindagem
    box3(m, '#cfd8dc', x0 + 44.5, cy - 3.8, zt, 6.5, 7.6, 3.0)         # micro-USB (à direita)
    for by in (cy - 9.5, cy + 8.2):                                     # BOOT e EN
        box3(m, '#eeeeee', x0 + 40, by, zt, 3.4, 2.4, 1.5)
    return fp


# ----------------------------------------------------------------- TJA1050 (22 x 11 mm) em barra fêmea 1x04
def fp_tja():
    fp = Fp('TJA1050_Module_Socket', 'Modulo TJA1050 22 x 11 mm em barra femea 1x04 (VCC, TXD, RXD, GND), deitado para a direita',
            ref_at=(-2.4, -1.2), val_at=(10, 3.81), ref_size=0.9)
    pads = [(0, i * P) for i in range(4)]
    for i, (x, y) in enumerate(pads):
        fp.pad(str(i + 1), x, y, 1.7, 1.0, square=(i == 0))
    courtyard_rows(fp, pads, 1.3)
    x0 = -1.2
    yc = 1.5 * P
    y0 = yc - gp.TJA_MM[1] / 2
    fp.rect('F.Fab', x0, y0, x0 + gp.TJA_MM[0], y0 + gp.TJA_MM[1], 0.1)
    fp.text('F.Fab', x0 + 11, yc, 'TJA1050', 1.0)
    fp.model(f'{MOD3D}/Connector_PinSocket_2.54mm.3dshapes/PinSocket_1x04_P2.54mm_Vertical.step', (0, 0, 0), 0)
    own_model(fp, 'TJA1050_Module')
    m = 'TJA1050_Module'
    box3(m, '#111111', -P / 2, -P / 2, FEM_H, P, 4 * P, MALE_H)
    box3(m, '#1565c0', x0, y0, MOD_Z, gp.TJA_MM[0], gp.TJA_MM[1], MOD_T)
    mt = MOD_Z + MOD_T
    box3(m, '#212121', x0 + 5.0, yc - 2.6, mt, 5.6, 5.2, 1.5)           # TJA1050 (SOIC-8)
    box3(m, '#212121', x0 + 12.4, y0 + 1.0, mt, 2.4, 1.4, 0.5)          # resistor "121"
    return fp


# ----------------------------------------------------------------- RT8272 (HW-108, 21 x 21 mm)
def fp_buck():
    fp = Fp('RT8272_HW108_Socket', 'Step-down RT8272 (HW-108) 21 x 21 mm em barras femea: EN, IN-, IN+ e OUT-, OUT+ (fileiras a 17,78 mm)',
            ref_at=(-8.9, 6.4), val_at=(-8.9, 9.0), ref_size=1.0)
    ins = [(0, i * P) for i in range(3)]
    outs = [(-7 * P, 6 * P), (-7 * P, 7 * P)]
    for i, (x, y) in enumerate(ins + outs):
        fp.pad(str(i + 1), x, y, 1.8, 1.0, square=(i == 0))
    courtyard_rows(fp, ins, 1.3)
    courtyard_rows(fp, outs, 1.3)
    bx0, by0 = -7 * P - 1.5, -1.2
    fp.rect('F.Fab', bx0, by0, bx0 + gp.BUCK_MM, by0 + gp.BUCK_MM, 0.1)
    fp.text('F.Fab', bx0 + 10.5, by0 + 5, 'RT8272 5,0 V', 1.0)
    fp.model(f'{MOD3D}/Connector_PinSocket_2.54mm.3dshapes/PinSocket_1x03_P2.54mm_Vertical.step', (0, 0, 0), 0)
    fp.model(f'{MOD3D}/Connector_PinSocket_2.54mm.3dshapes/PinSocket_1x02_P2.54mm_Vertical.step', (-7 * P, 6 * P, 0), 0)
    own_model(fp, 'RT8272_HW108')
    m = 'RT8272_HW108'
    box3(m, '#111111', -P / 2, -P / 2, FEM_H, P, 3 * P, MALE_H)
    box3(m, '#111111', -7 * P - P / 2, 6 * P - P / 2, FEM_H, P, 2 * P, MALE_H)
    box3(m, '#0d47a1', bx0, by0, MOD_Z, gp.BUCK_MM, gp.BUCK_MM, MOD_T)
    bt = MOD_Z + MOD_T
    box3(m, '#212121', bx0 + 10.5, by0 + 9.5, bt, 9, 9, 4.0)            # bobina 4R7
    box3(m, '#212121', bx0 + 5.5, by0 + 2.0, bt, 6, 5, 1.2)             # RT8272
    box3(m, '#cfd8dc', bx0 + 0.8, by0 + 0.8, bt, 3.4, 3.4, 2.2)         # trimpot
    return fp


# ----------------------------------------------------------------- AS-06 (5 x 20 mm, com tampa)
def fp_fuse():
    L = 8 * P   # 20,32 mm: os pinos chatos (20,2 ± 0,3 mm) caem em dois furos da grade
    fp = Fp('Fuseholder_AS06_5x20_P20.32', 'Porta-fusivel AS-06 5 x 20 mm com tampa (26 x 9,6 mm, 14,1 mm de altura), pinos chatos 1,3 x 0,4 mm, furo de 1,5 mm',
            ref_at=(-L / 2, 0), val_at=(-L / 2, 3.0), ref_size=1.0)
    fp.pad('1', 0, 0, 2.8, 1.5, square=True)   # IN (12 V do OBD), à direita
    fp.pad('2', -L, 0, 2.8, 1.5)               # OUT (12 V com fusível)
    cx = -L / 2
    fw, fd = gp.FUSE_MM
    fp.rect('F.CrtYd', cx - fw / 2 - 0.25, -fd / 2 - 0.25, cx + fw / 2 + 0.25, fd / 2 + 0.25, 0.05)
    fp.rect('F.Fab', cx - fw / 2, -fd / 2, cx + fw / 2, fd / 2, 0.1)
    own_model(fp, 'Fuseholder_AS06')
    m = 'Fuseholder_AS06'
    fb = gp.FUSE_BODY
    for sx in (-1, 1):   # pés de 1 mm nas pontas
        box3(m, '#1b1b1b', cx + sx * (fb / 2 - 1.5) - 1.5, -fd / 2, 0, 3.0, fd, 1.0)
    box3(m, '#1b1b1b', cx - fb / 2, -fd / 2, 1.0, fb, fd, 11.5)        # corpo
    box3(m, '#111111', cx - fw / 2, -fd / 2, 12.5, fw, fd, 1.6)        # tampa (topo a 14,1 mm)
    return fp


# ----------------------------------------------------------------- cabo OBD (fios soldados)
def fp_obd():
    fp = Fp('OBD_Pigtail_4W', 'Ilhas para os fios do cabo OBD2: pino 16 (+12 V), 4 e 5 (GND) e 14 (CAN-L)',
            ref_at=(2.54, 2.4), val_at=(9, 4.2), ref_size=0.9)
    xs = {'16': 0, '4': P, '5': 2 * P, '14': 7 * P}
    for k, x in xs.items():
        fp.pad(k, x, 0, 2.0, 1.1, square=(k == '16'))
    fp.rect('F.CrtYd', -1.25, -1.25, 2 * P + 1.25, 1.25, 0.05)
    fp.rect('F.CrtYd', 7 * P - 1.25, -1.25, 7 * P + 1.25, 1.25, 0.05)
    return fp


# ----------------------------------------------------------------- barras macho deitadas (pino 1 à esquerda)
def fp_header(n):
    fp = Fp(f'PinHeader_1x{n:02d}_H', f'Barra macho 1x{n:02d} 2,54 mm, deitada na placa (pino 1 a esquerda)',
            ref_at=(-2.3, 0), val_at=((n - 1) * P / 2, 2.2), ref_size=0.8)
    pads = [(i * P, 0) for i in range(n)]
    for i, (x, y) in enumerate(pads):
        fp.pad(str(i + 1), x, y, 1.7, 1.0, square=(i == 0))
    fp.rect('F.CrtYd', -1.25, -1.25, (n - 1) * P + 1.25, 1.25, 0.05)
    fp.rect('F.Fab', -1.27, -1.27, (n - 1) * P + 1.27, 1.27, 0.1)
    fp.model(f'{MOD3D}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x{n:02d}_P2.54mm_Vertical.step', (0, 0, 0), -90)
    return fp


def fp_res():
    L = 4 * P
    fp = Fp('R_Axial_DIN0207_P10.16mm', 'Resistor 1/4 W (DIN0207, 6,3 x 2,5 mm) deitado, pernas a 10,16 mm',
            ref_at=(L / 2, 0), val_at=(L / 2, 2.4), ref_size=0.8)
    fp.pad('1', 0, 0, 1.6, 0.8, square=True)
    fp.pad('2', L, 0, 1.6, 0.8)
    a, b = (L - 6.3) / 2, (L + 6.3) / 2
    fp.poly('F.CrtYd', [(-0.95, -0.95), (a, -0.95), (a, -1.5), (b, -1.5), (b, -0.95), (L + 0.95, -0.95),
                        (L + 0.95, 0.95), (b, 0.95), (b, 1.5), (a, 1.5), (a, 0.95), (-0.95, 0.95)])
    fp.rect('F.Fab', a, -1.25, b, 1.25, 0.1)
    fp.model(f'{MOD3D}/Resistor_THT.3dshapes/R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal.step')
    return fp


def fp_cap():
    L = 2 * P
    fp = Fp('C_Disc_D5.0mm_P5.08mm', 'Capacitor ceramico de disco 5 mm (104), pernas a 5,08 mm',
            ref_at=(L / 2, 0), val_at=(L / 2, 2.4), ref_size=0.8)
    fp.pad('1', 0, 0, 1.6, 0.8, square=True)
    fp.pad('2', L, 0, 1.6, 0.8)
    fp.rect('F.CrtYd', -0.95, -1.5, L + 0.95, 1.5, 0.05)
    fp.rect('F.Fab', L / 2 - 2.5, -1.25, L / 2 + 2.5, 1.25, 0.1)
    fp.model(f'{MOD3D}/Capacitor_THT.3dshapes/C_Disc_D5.0mm_W2.5mm_P5.00mm.step', (0.04, 0, 0))
    return fp


def fp_tp():
    fp = Fp('TestPoint_Keystone_5000', 'Ponto de teste Keystone 5000/5001 (laco de metal), furo de 1 mm',
            ref_at=(0, -2.0), val_at=(0, 2.0), ref_size=0.8)
    fp.pad('1', 0, 0, 1.8, 1.0)
    fp.rect('F.CrtYd', -1.0, -1.0, 1.0, 1.0, 0.05)
    own_model(fp, 'TestPoint_Keystone_5000')
    box3('TestPoint_Keystone_5000', '#c62828', -0.9, -0.3, 0, 1.8, 0.6, 1.2)
    box3('TestPoint_Keystone_5000', '#cfd8dc', -0.9, -0.15, 1.2, 1.8, 0.3, 3.6)
    return fp


def write_fp_lib():
    d = os.path.join(AQUI, f'{LIB}.pretty')
    d3 = os.path.join(AQUI, f'{LIB}.3dshapes')
    for x in (d, d3):
        shutil.rmtree(x, ignore_errors=True)
        os.makedirs(x)
    BOXES.clear()
    for fp in (fp_esp(), fp_tja(), fp_buck(), fp_fuse(), fp_obd(), fp_header(2), fp_header(4), fp_header(5),
               fp_res(), fp_cap(), fp_tp()):
        FPS[fp.nome] = fp
        open(os.path.join(d, f'{fp.nome}.kicad_mod'), 'w').write(fp.text_sexpr())
    for nome, boxes in BOXES.items():
        write_wrl(os.path.join(d3, f'{nome}.wrl'), boxes)
        write_step(os.path.join(d3, f'{nome}.step'), nome, boxes)
    open(os.path.join(AQUI, 'fp-lib-table'), 'w').write(
        f'(fp_lib_table (version 7)\n  (lib (name "{LIB}")(type "KiCad")(uri "${{KIPRJMOD}}/{LIB}.pretty")(options "")(descr "Escuta CAN do Uno"))\n)\n')
    open(os.path.join(AQUI, 'sym-lib-table'), 'w').write(
        f'(sym_lib_table (version 7)\n  (lib (name "{LIB}")(type "KiCad")(uri "${{KIPRJMOD}}/{LIB}.kicad_sym")(options "")(descr "Escuta CAN do Uno"))\n)\n')


# ======================================================================= projeto (.kicad_pro) e regras (.kicad_dru)
def write_project():
    nc = lambda nome, w: {'name': nome, 'clearance': 0.2, 'track_width': w, 'via_diameter': 0.6, 'via_drill': 0.3,
                          'microvia_diameter': 0.3, 'microvia_drill': 0.1, 'diff_pair_width': 0.2, 'diff_pair_gap': 0.25,
                          'diff_pair_via_gap': 0.25, 'wire_width': 6, 'bus_width': 12, 'line_style': 0,
                          'schematic_color': 'rgba(0, 0, 0, 0.000)', 'pcb_color': 'rgba(0, 0, 0, 0.000)', 'priority': 2147483647 if nome == 'Default' else 0}
    pro = {
        'board': {'design_settings': {
            'defaults': {'board_outline_line_width': 0.1, 'copper_line_width': 0.2, 'silk_line_width': 0.12,
                         'silk_text_size_h': 1.0, 'silk_text_size_v': 1.0, 'silk_text_thickness': 0.15},
            'rules': {'min_clearance': 0.2, 'min_track_width': 0.25, 'min_via_diameter': 0.6, 'min_via_annular_width': 0.13,
                      'min_through_hole_diameter': 0.3, 'min_hole_clearance': 0.25, 'min_hole_to_hole': 0.25,
                      'min_copper_edge_clearance': 0.3, 'min_silk_clearance': 0.0, 'min_text_height': 0.8,
                      'min_text_thickness': 0.12, 'solder_mask_to_copper_clearance': 0.0},
            'track_widths': [0.0, 0.3, 0.6, 0.8, 1.0], 'via_dimensions': [{'diameter': 0.0, 'drill': 0.0}, {'diameter': 0.6, 'drill': 0.3}],
        }},
        'meta': {'filename': f'{PROJ}.kicad_pro', 'version': 3},
        'net_settings': {
            'classes': [nc('Default', 0.3), nc('Power', 0.8)],
            'meta': {'version': 4},
            'netclass_patterns': [{'netclass': 'Power', 'pattern': n} for n in POWER],
        },
        'pcbnew': {'last_paths': {}},
        'schematic': {'meta': {'version': 1}},
        'sheets': [[uid('sheet', PROJ), 'Root']],
    }
    json.dump(pro, open(os.path.join(AQUI, f'{PROJ}.kicad_pro'), 'w'), indent=2)
    open(os.path.join(AQUI, f'{PROJ}.kicad_dru'), 'w').write(
        '(version 1)\n'
        '(rule "Alimentacao: trilha de pelo menos 0,6 mm"\n  (condition "A.NetClass == \'Power\'")\n  (constraint track_width (min 0.6mm)))\n'
        '(rule "Sinal: trilha de pelo menos 0,25 mm"\n  (condition "A.NetClass == \'Default\'")\n  (constraint track_width (min 0.25mm)))\n')


# ======================================================================= esquemático
SCH_POS = {   # posição de cada símbolo no A3 (mm, múltiplos de 2,54)
    'J1': (38.1, 50.8), 'F1': (38.1, 78.74), 'U3': (38.1, 104.14), 'TP1': (35.56, 134.62), 'TP2': (35.56, 147.32),
    'TP3': (35.56, 160.02), 'TP4': (35.56, 172.72),
    'U2': (104.14, 50.8), 'J2': (104.14, 78.74), 'R4': (104.14, 96.52), 'R1': (104.14, 114.3), 'R2': (104.14, 132.08),
    'R3': (104.14, 149.86), 'R5': (104.14, 167.64), 'R6': (104.14, 185.42), 'C1': (104.14, 203.2),
    'U1': (195.58, 104.14),
    'J3': (287.02, 50.8), 'J4': (287.02, 76.2), 'J5': (287.02, 101.6), 'J6': (287.02, 132.08),
}


def write_schematic():
    root = uid('sheet', PROJ)
    used = sorted({p['sym'] for p in PARTS})
    libsyms = '\n'.join(sym_text(n, f'{LIB}:{n}') for n in used)
    out = [f'(kicad_sch (version 20250114) (generator "eeschema") (generator_version "9.0") (uuid "{root}") (paper "A3")',
           '(title_block (title "Escuta CAN listen-only: Fiat Uno Vivace 2012 (TJA1050)") (date "2026-11-26") (rev "2.0") '
           '(company "Universal OBD Dashboard") (comment 1 "Mesmo circuito da placa ilhada 5 x 7 cm (veiculos/fiat-uno-vivace-2012/placa)") '
           '(comment 2 "Só escuta: TXD preso em 5 V; RXD por divisor; CANH em 3,3 V (R4)"))',
           f'(lib_symbols\n{libsyms}\n)']
    notas = [
        (20.32, 22.86, 'ALIMENTAÇÃO: OBD 16 (+12 V) → F1 1,5 A → RT8272 (5,0 V). OBD 4 e 5: GND.'),
        (20.32, 27.94, 'CAN (só escuta): OBD 14 (CAN-L do painel) → CANL do TJA1050; CANH em 3,3 V por R4 (1 kΩ). O pino 6 do OBD fica sem ligação.'),
        (20.32, 33.02, 'RX do TJA1050 (5 V) → R1 1 kΩ → D21 do ESP32 ← R2 + R3 (2 kΩ) ao GND: 3,33 V no pino. TXD preso em 5 V: o transceptor nunca transmite.'),
        (20.32, 38.1, 'Bateria: 12 V com fusível → R5 100 kΩ → D34 (ADC1) → R6 20 kΩ → GND, C1 100 nF de filtro. 12 V = 2,0 V no pino.'),
        (20.32, 43.18, 'Sensores I2C (D25 = SDA, D26 = SCL), alimentados em 5 V (os módulos têm regulador): GY-273, LSM6DS3, BMP180.'),
    ]
    for x, y, t in notas:
        out.append(f'(text "{t}" (exclude_from_sim no) (at {x} {y} 0) (effects (font (size 1.6 1.6)) (justify left)) (uuid "{uid("nota", t)}"))')
    for p in PARTS:
        X, Y = SCH_POS[p['ref']]
        Y = round(Y + 15.24, 2)   # abaixo das notas
        w, h = sym_body(p['sym'])
        lid = f'{LIB}:{p["sym"]}'
        su = uid('sym', p['ref'])
        props = [
            f'(property "Reference" "{p["ref"]}" (at {X} {round(Y - h / 2 - 1.27, 2)} 0) {fnt()})',
            f'(property "Value" "{p["value"]}" (at {X} {round(Y + h / 2 + 1.27, 2)} 0) {fnt()})',
            f'(property "Footprint" "{LIB}:{p["fp"]}" (at {X} {Y} 0) {fnt(extra=" (hide yes)")})',
            f'(property "Datasheet" "" (at {X} {Y} 0) {fnt(extra=" (hide yes)")})',
            f'(property "Description" "{p["desc"]}" (at {X} {Y} 0) {fnt(extra=" (hide yes)")})',
            f'(property "LCSC" "" (at {X} {Y} 0) {fnt(extra=" (hide yes)")})',
        ]
        pins = ' '.join(f'(pin "{num}" (uuid "{uid("pin", p["ref"], num)}"))' for num in p['pins'])
        out.append(f'(symbol (lib_id "{lid}") (at {X} {Y} 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) '
                   f'(uuid "{su}") {" ".join(props)} {pins} (instances (project "{PROJ}" (path "/{root}" (reference "{p["ref"]}") (unit 1)))))')
        for num, pn, px, py, ang in sym_pins(p['sym']):
            ex, ey = round(X + px, 2), round(Y - py, 2)
            net = p['pins'][num][1]
            if net is None:
                out.append(f'(no_connect (at {ex} {ey}) (uuid "{uid("nc", p["ref"], num)}"))')
                continue
            dx = -2.54 if ang == 0 else 2.54
            lx = round(ex + dx, 2)
            out.append(f'(wire (pts (xy {ex} {ey}) (xy {lx} {ey})) (stroke (width 0) (type default)) (uuid "{uid("w", p["ref"], num)}"))')
            la, just = (180, 'right') if ang == 0 else (0, 'left')
            out.append(f'(global_label "{net}" (shape passive) (at {lx} {ey} {la}) (fields_autoplaced yes) '
                       f'(effects (font (size 1.27 1.27)) (justify {just})) (uuid "{uid("gl", p["ref"], num)}") '
                       f'(property "Intersheetrefs" "${{INTERSHEET_REFS}}" (at {lx} {ey} 0) (effects (font (size 1.27 1.27)) (hide yes))))')
    out.append('(sheet_instances (path "/" (page "1")))')
    out.append('(embedded_fonts no))')
    open(os.path.join(AQUI, f'{PROJ}.kicad_sch'), 'w').write('\n'.join(out) + '\n')


# ======================================================================= placa
# Trilhas (rede, largura mm, camada 'F' ou 'B', pontos (coluna, linha)). Plano de GND nas duas faces (o de baixo é o
# principal); os pads de GND ligam por alívio térmico, sem trilha.
TRACKS = [
    # 12 V do OBD → fusível; 12 V com fusível → RT8272, R5 e TP1
    ('12V', 1.0, 'F', [(11, 24), (9, 24)]),
    ('12V_FUS', 0.8, 'F', [(1, 24), (1, 23), (8, 23), (8, 16)]),
    ('12V_FUS', 0.6, 'F', [(4, 23), (4, 21)]),
    ('12V_FUS', 0.6, 'F', [(8, 23), (11, 23)]),
    # 5 V: RT8272 → VIN do ESP32 (linha 13, logo abaixo das barras), TP2, sensores e TJA1050 (VCC e TXD)
    ('5V', 0.8, 'F', [(1, 21), (2, 21), (2, 13), (16, 13), (16, 12)]),
    ('5V', 0.6, 'F', [(16, 13), (16, 15), (15, 15), (15, 17), (15, 18), (11, 18), (11, 20)]),
    # 3V3 do ESP32 → R4
    ('3V3', 0.6, 'F', [(16, 2), (16, 3)]),
    # CAN: R4 → CANH (por baixo, coluna 18) → J2; CANL do J2 → OBD 14
    ('CANH', 0.3, 'B', [(16, 7), (18, 7), (18, 23), (16, 23), (16, 24)]),
    ('CANL', 0.5, 'F', [(17, 24), (18, 24)]),
    # RX: TJA1050 (5 V) → R1 → D21; divisor R2 + R3
    ('CAN_RX_5V', 0.3, 'F', [(11, 3), (11, 4), (17, 4), (17, 21), (11, 21)]),
    ('CAN_RX_3V3', 0.3, 'F', [(6, 2), (6, 3), (7, 3)]),
    ('CAN_RX_3V3', 0.3, 'F', [(6, 3), (6, 4)]),
    ('RX_DIV', 0.3, 'F', [(6, 8), (7, 8)]),
    # Bateria: junção R5/R6/C1 → D34 (por baixo, coluna 5)
    ('VBAT_ADC', 0.3, 'B', [(5, 12), (5, 20)]),
    ('VBAT_ADC', 0.3, 'B', [(4, 17), (5, 17)]),
    # GND dos conectores dos sensores (coluna 14) até o GND do ESP32, por baixo: o plano ali fica cercado pelo I2C
    ('GND', 0.6, 'B', [(14, 17), (14, 13), (15, 13), (15, 12)]),
    # I2C por baixo (cruza a linha do 5 V): D25 → SDA (coluna 12), D26 → SCL (coluna 13)
    ('SDA', 0.3, 'B', [(9, 12), (9, 14), (12, 14), (12, 17)]),
    ('SCL', 0.3, 'B', [(10, 12), (10, 13), (13, 13), (13, 17)]),
] + [(f'LED_{k}', 0.3, 'F', [(c, r), (c, r + 1)]) for k, (c, r) in gp.LED_PINS.items()]

TEXTOS_F = [   # (texto, coluna, linha, tamanho)
    ('ESP32 DevKit V1', 9.5, 9.7, 1.2), ('USB →', 15.0, 10.9, 0.9), ('← antena', 3.6, 10.9, 0.9),
    ('RT8272 5,0 V', 4.6, 14.6, 1.0), ('FUSÍVEL 1,5 A', 5.0, 22.85, 0.9),
    ('TJA1050', 14.2, 19.6, 1.0), ('OBD 16 4 5', 12.0, 25.55, 0.8), ('14', 18.0, 25.55, 0.8), ('CAN H L', 16.5, 22.4, 0.8),
    ('GY-273', 17.4, 15.0, 0.8), ('LSM6DS3', 17.4, 16.0, 0.8), ('BMP180', 17.4, 17.0, 0.8),
    ('LED RGB', 14.6, 1.0, 0.8), ('C', 8, 0.15, 0.8), ('R', 10, 0.15, 0.8), ('G', 11, 0.15, 0.8), ('B', 12, 0.15, 0.8),
]
TEXTOS_B = [
    ('ESCUTA CAN · UNO VIVACE 2012', 9.0, 5.0, 1.0), ('somente escuta (listen-only) · TJA1050', 9.0, 6.0, 0.85),
    ('v2.0 · 50 × 70 mm · 2 camadas', 9.0, 7.0, 0.85),
]
REF_AT = {'TP1': (-2.4, 0)}   # referências fora do lugar padrão do footprint (mm, relativas ao pad 1)


def build_board():
    import pcbnew
    mm = pcbnew.FromMM
    V = lambda x, y: pcbnew.VECTOR2I(mm(OX + x), mm(OY + y))
    board = pcbnew.BOARD()
    ds = board.GetDesignSettings()
    ds.SetCopperLayerCount(2)
    nets = {}
    for n in NETS:
        ni = pcbnew.NETINFO_ITEM(board, n)
        board.Add(ni)
        nets[n] = ni
    # contorno
    sh = pcbnew.PCB_SHAPE(board)
    sh.SetShape(pcbnew.SHAPE_T_RECT)
    sh.SetStart(V(0, 0))
    sh.SetEnd(V(W, H))
    sh.SetLayer(pcbnew.Edge_Cuts)
    sh.SetWidth(mm(0.1))
    board.Add(sh)
    libdir = os.path.join(AQUI, f'{LIB}.pretty')
    root = uid('sheet', PROJ)
    pads_xy = []   # (x, y, raio, rede) para a costura de vias
    for p in PARTS:
        fp = pcbnew.FootprintLoad(libdir, p['fp'])
        fp.SetFPID(pcbnew.LIB_ID(LIB, p['fp']))
        fp.SetReference(p['ref'])
        fp.SetValue(p['value'])
        fp.SetPath(pcbnew.KIID_PATH(f'/{uid("sym", p["ref"])}'))
        n1, n2 = PAD_REF.get(p['ref'], ('1', '2'))
        x1, y1 = g(*p['at'])
        pads = {pd.GetNumber(): pd for pd in fp.Pads()}
        ang = 0.0
        if p['at2']:
            # ângulo que leva o vetor pad n1 → pad n2 do footprint até o vetor at → at2 na placa (tela: y para baixo)
            q1, q2 = pads[n1].GetPosition(), pads[n2].GetPosition()
            fx, fy = pcbnew.ToMM(q2.x - q1.x), pcbnew.ToMM(q2.y - q1.y)
            x2, y2 = g(*p['at2'])
            ang = round((math.degrees(math.atan2(-(y2 - y1), x2 - x1)) - math.degrees(math.atan2(-fy, fx))) % 360, 3)
        fp.SetOrientationDegrees(ang)
        fp.SetPosition(V(0, 0))
        q1 = pads[n1].GetPosition()
        fp.SetPosition(pcbnew.VECTOR2I(mm(OX + x1) - (q1.x - mm(OX)), mm(OY + y1) - (q1.y - mm(OY))))
        if p['at2']:
            q2 = pads[n2].GetPosition()
            x2, y2 = g(*p['at2'])
            assert abs(pcbnew.ToMM(q2.x) - OX - x2) < 0.01 and abs(pcbnew.ToMM(q2.y) - OY - y2) < 0.01, (p['ref'], ang)
        for pd in fp.Pads():
            pn, net = p['pins'][pd.GetNumber()]
            if not net:
                pn = {num: nome for num, nome, *_ in sym_pins(p['sym'])}[pd.GetNumber()]   # nome do pino no símbolo
                net = f'unconnected-({p["ref"]}-{pn}-Pad{pd.GetNumber()})'
                ni = pcbnew.NETINFO_ITEM(board, net)
                board.Add(ni)
                nets[net] = ni
            pd.SetNet(nets[net])
        if p['ref'] in REF_AT:
            q1 = pads[n1].GetPosition()
            fp.Reference().SetPosition(pcbnew.VECTOR2I(q1.x + mm(REF_AT[p['ref']][0]), q1.y + mm(REF_AT[p['ref']][1])))
        board.Add(fp)
        for pd in fp.Pads():
            q = pd.GetPosition()
            raio = pcbnew.ToMM(pd.GetSize(pcbnew.F_Cu).x) / 2 * (math.sqrt(2) if pd.GetShape() == pcbnew.PAD_SHAPE_RECT else 1)
            pads_xy.append((pcbnew.ToMM(q.x) - OX, pcbnew.ToMM(q.y) - OY, raio, p['pins'][pd.GetNumber()][1]))
    # trilhas
    segs = []
    for net, w, lay, pts in TRACKS:
        layer = pcbnew.F_Cu if lay == 'F' else pcbnew.B_Cu
        for a, b in zip(pts, pts[1:]):
            t = pcbnew.PCB_TRACK(board)
            t.SetStart(V(*g(*a)))
            t.SetEnd(V(*g(*b)))
            t.SetWidth(mm(w))
            t.SetLayer(layer)
            t.SetNet(nets[net])
            board.Add(t)
            segs.append((g(*a), g(*b), w / 2))
    # zonas de GND (as duas faces) e áreas proibidas nos apoios da caixa
    def zona(layer, prio):
        z = pcbnew.ZONE(board)
        z.SetLayer(layer)
        z.SetNet(nets['GND'])
        e = 0.3
        ol = z.Outline()
        ol.NewOutline()
        for x, y in ((e, e), (W - e, e), (W - e, H - e), (e, H - e)):
            ol.Append(mm(OX + x), mm(OY + y))
        z.SetLocalClearance(mm(0.3))
        z.SetMinThickness(mm(0.25))
        z.SetThermalReliefGap(mm(0.4))
        z.SetThermalReliefSpokeWidth(mm(0.5))
        z.SetPadConnection(pcbnew.ZONE_CONNECTION_THERMAL)
        z.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_ALWAYS)
        z.SetAssignedPriority(prio)
        z.SetZoneName(f'GND_{"B" if layer == pcbnew.B_Cu else "F"}')
        board.Add(z)
    zona(pcbnew.B_Cu, 1)
    zona(pcbnew.F_Cu, 0)
    for sx in (0, 1):
        for sy in (0, 1):
            z = pcbnew.ZONE(board)
            z.SetIsRuleArea(True)
            ls = pcbnew.LSET()
            ls.AddLayer(pcbnew.F_Cu)
            ls.AddLayer(pcbnew.B_Cu)
            z.SetLayerSet(ls)
            z.SetDoNotAllowTracks(True)
            z.SetDoNotAllowVias(True)
            z.SetDoNotAllowPads(True)
            z.SetDoNotAllowCopperPour(True)
            z.SetDoNotAllowFootprints(False)
            z.SetZoneName('apoio da caixa')
            x0 = 0 if sx == 0 else W - APOIO
            y0 = 0 if sy == 0 else H - APOIO
            ol = z.Outline()
            ol.NewOutline()
            for x, y in ((x0, y0), (x0 + APOIO, y0), (x0 + APOIO, y0 + APOIO), (x0, y0 + APOIO)):
                ol.Append(mm(OX + x), mm(OY + y))
            board.Add(z)
    # costura de vias: GND nos meios de grade (a cada 2 furos), longe de pads, trilhas, bordas e apoios
    def dist_seg(p, a, b):
        (px, py), (ax, ay), (bx, by) = p, a, b
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
        return math.hypot(px - ax - t * dx, py - ay - t * dy)
    VR, FOLGA = 0.3, 0.35
    vias = []
    for c in [x + 0.5 for x in range(0, 19)]:
        for r in [y + 0.5 for y in range(0, 25)]:
            x, y = g(c, r)
            if not (1.6 < x < W - 1.6 and 1.6 < y < H - 1.6):
                continue
            if (x < APOIO + 1 or x > W - APOIO - 1) and (y < APOIO + 1 or y > H - APOIO - 1):
                continue
            if any(math.hypot(x - px, y - py) < pr + VR + FOLGA for px, py, pr, _ in pads_xy):
                continue
            if any(dist_seg((x, y), a, b) < hw + VR + FOLGA for a, b, hw in segs):
                continue
            if any(math.hypot(x - vx, y - vy) < 4.0 for vx, vy in vias):
                continue
            vias.append((x, y))
    for x, y in vias:
        v = pcbnew.PCB_VIA(board)
        v.SetPosition(V(x, y))
        v.SetViaType(pcbnew.VIATYPE_THROUGH)
        v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
        v.SetWidth(mm(0.6))
        v.SetDrill(mm(0.3))
        v.SetNet(nets['GND'])
        board.Add(v)
    # textos da serigrafia
    for layer, textos in ((pcbnew.F_SilkS, TEXTOS_F), (pcbnew.B_SilkS, TEXTOS_B)):
        for t, c, r, s in textos:
            tx = pcbnew.PCB_TEXT(board)
            tx.SetText(t)
            tx.SetPosition(V(*g(c, r)))
            tx.SetLayer(layer)
            tx.SetTextSize(pcbnew.VECTOR2I(mm(s), mm(s)))
            tx.SetTextThickness(mm(max(0.12, s * 0.15)))
            if layer == pcbnew.B_SilkS:
                tx.SetMirrored(True)
            board.Add(tx)
    path = os.path.join(AQUI, f'{PROJ}.kicad_pcb')
    board.Save(path)
    # encher as zonas numa placa aberta do arquivo (o enchedor precisa da placa carregada com o projeto)
    b2 = pcbnew.LoadBoard(path)
    b2.BuildConnectivity()
    pcbnew.ZONE_FILLER(b2).Fill(b2.Zones())
    zonas = [z for z in b2.Zones() if not z.GetIsRuleArea()]
    soltas = [t for t in b2.GetTracks() if t.GetClass() == 'PCB_VIA' and t.GetNetname() == 'GND' and
              not all(any(z.GetLayer() == lay and z.HitTestFilledArea(lay, t.GetPosition(), 0) for z in zonas)
                      for lay in (pcbnew.F_Cu, pcbnew.B_Cu))]
    for t in soltas:
        b2.Remove(t)
    if soltas:
        b2.BuildConnectivity()
        pcbnew.ZONE_FILLER(b2).Fill(b2.Zones())
    b2.Save(path)
    vias = vias[:len(vias) - len(soltas)]
    return path, len(vias)


# ======================================================================= conferência e exportação
def cli(*args, ok_codes=(0,)):
    env = dict(os.environ, KICAD9_3DMODEL_DIR='/usr/share/kicad/3dmodels')
    r = subprocess.run(['kicad-cli', *args], cwd=AQUI, capture_output=True, text=True, env=env)
    if r.returncode not in ok_codes:
        sys.exit(f'kicad-cli {" ".join(args)} falhou ({r.returncode}):\n{r.stdout}\n{r.stderr}')
    return r


def erc_drc():
    sch, pcb = f'{PROJ}.kicad_sch', f'{PROJ}.kicad_pcb'
    r = cli('sch', 'erc', '--exit-code-violations', '--severity-all', '--format', 'json', '-o', 'erc.json', sch, ok_codes=(0, 5))
    erc = json.load(open(os.path.join(AQUI, 'erc.json')))
    ev = [v for s in erc.get('sheets', []) for v in s.get('violations', [])]
    r2_ = cli('pcb', 'drc', '--exit-code-violations', '--schematic-parity', '--severity-all', '--format', 'json',
              '-o', 'drc.json', pcb, ok_codes=(0, 5))
    drc = json.load(open(os.path.join(AQUI, 'drc.json')))
    dv = drc.get('violations', [])
    un = drc.get('unconnected_items', [])
    par = drc.get('schematic_parity', [])
    return ev, dv, un, par


def exportar():
    pcb, sch = f'{PROJ}.kicad_pcb', f'{PROJ}.kicad_sch'
    shutil.rmtree(FAB, ignore_errors=True)
    os.makedirs(FAB)
    gdir = os.path.join(AQUI, 'gerber')
    shutil.rmtree(gdir, ignore_errors=True)
    os.makedirs(gdir)
    cli('pcb', 'export', 'gerbers', '--layers', 'F.Cu,B.Cu,F.Paste,B.Paste,F.SilkS,B.SilkS,F.Mask,B.Mask,Edge.Cuts',
        '--subtract-soldermask', '-o', 'gerber/', pcb)
    cli('pcb', 'export', 'drill', '--format', 'excellon', '--excellon-separate-th', '--generate-map', '--map-format', 'gerberx2',
        '--drill-origin', 'absolute', '-o', 'gerber/', pcb)
    zpath = os.path.join(FAB, 'gerbers-escuta-can-uno.zip')
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
        for n in sorted(os.listdir(gdir)):
            z.write(os.path.join(gdir, n), n)
    gerbers = sorted(os.listdir(gdir))
    shutil.rmtree(gdir)
    # BOM (padrão JLCPCB: Comment, Designator, Footprint, LCSC)
    grupos = {}
    for p in sorted(PARTS, key=lambda p: p['ref']):
        grupos.setdefault((p['value'], p['fp']), []).append(p['ref'])
    with open(os.path.join(FAB, 'BOM.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Comment', 'Designator', 'Footprint', 'Quantity', 'LCSC'])
        for (val, fp), refs in sorted(grupos.items(), key=lambda kv: kv[1][0]):
            w.writerow([val, ','.join(refs), fp, len(refs), ''])
    # CPL (padrão JLCPCB: Designator, Mid X, Mid Y, Layer, Rotation): centro dos pads de cada peça, com a origem no
    # canto de baixo à esquerda da placa e o Y para cima
    import pcbnew
    b = pcbnew.LoadBoard(os.path.join(AQUI, pcb))
    with open(os.path.join(FAB, 'CPL.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Designator', 'Mid X', 'Mid Y', 'Layer', 'Rotation'])
        for fp in sorted(b.GetFootprints(), key=lambda fp: fp.GetReference()):
            xs = [pcbnew.ToMM(pd.GetPosition().x) for pd in fp.Pads()]
            ys = [pcbnew.ToMM(pd.GetPosition().y) for pd in fp.Pads()]
            x = (min(xs) + max(xs)) / 2 - OX
            y = H - ((min(ys) + max(ys)) / 2 - OY)
            w.writerow([fp.GetReference(), f'{x:.3f}mm', f'{y:.3f}mm', 'Top' if fp.GetLayer() == pcbnew.F_Cu else 'Bottom',
                        f'{fp.GetOrientationDegrees() % 360:.0f}'])
    # revisão 2D
    cli('sch', 'export', 'pdf', '-o', os.path.join(FAB, 'esquematico.pdf'), sch)
    cli('pcb', 'export', 'svg', '--layers', 'F.Cu,F.SilkS,F.Mask,Edge.Cuts', '--mode-single', '--fit-page-to-board',
        '--exclude-drawing-sheet', '-o', os.path.join(FAB, 'pcb-top.svg'), pcb)
    cli('pcb', 'export', 'svg', '--layers', 'B.Cu,B.SilkS,B.Mask,Edge.Cuts', '--mode-single', '--mirror', '--fit-page-to-board',
        '--exclude-drawing-sheet', '-o', os.path.join(FAB, 'pcb-bottom.svg'), pcb)
    # 3D
    r = cli('pcb', 'export', 'step', '--subst-models', '--force', '-o', os.path.join(FAB, 'escuta-can-uno.step'), pcb)
    faltando = [l for l in (r.stdout + r.stderr).splitlines() if 'not found' in l.lower() or 'could not' in l.lower()]
    for lado in ('top', 'bottom'):
        cli('pcb', 'render', '--quality', 'basic', '--side', lado, '-w', '1600', '-h', '1100', '--background', 'opaque',
            '-o', os.path.join(FAB, f'render-3d-{lado}.png'), pcb)
    return gerbers, faltando


def main():
    write_symbol_lib()
    write_fp_lib()
    write_project()
    write_schematic()
    _, nvias = build_board()
    ev, dv, un, par = erc_drc()
    print(f'ERC: {len(ev)} violações')
    for v in ev[:40]:
        print('  ERC', v.get('type'), v.get('description'), [i.get('description') for i in v.get('items', [])][:3])
    print(f'DRC: {len(dv)} violações, {len(un)} sem ligação, {len(par)} de paridade; {nvias} vias de costura')
    for v in (dv + un + par)[:60]:
        print('  DRC', v.get('type'), v.get('severity'), v.get('description'),
              [(i.get('description'), i.get('pos')) for i in v.get('items', [])][:2])
    if ev or dv or un or par:
        sys.exit('pare: ERC ou DRC com violações')
    gerbers, faltando = exportar()
    print('Gerber:', ', '.join(gerbers))
    if faltando:
        print('STEP, modelos faltando:', faltando)
    print('fabricacao/:', ', '.join(sorted(os.listdir(FAB))))


if __name__ == '__main__':
    main()
