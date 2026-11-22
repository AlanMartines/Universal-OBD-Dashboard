"""Gera a PCB de duas faces (trilhas fixas, para fábrica como JLCPCB ou PCBWay) da escuta CAN do Uno, versão SN65HVD230.

Exemplo de versão 2 da placa ilhada (pedido do Alan em 21/11/2026): mesmas peças, mesmas posições na grade de 2,54 mm e
mesmo tamanho (50 x 70 mm), para caber na mesma caixa e manter os módulos encaixados em barras fêmea. As posições vêm do
gerar_placa.py (versão SN65HVD230): mudou a placa ilhada, esta acompanha. Só R4 e TP3 têm lugar próprio aqui, para as
trilhas não se cruzarem. Face de cima: alimentação, CAN, 3V3 e LED. Face de baixo: plano de GND e os sinais que cruzam a
alimentação (I2C, D34 e CRX). Uma conferência simples das ligações para com erro se uma trilha ficar solta ou encostar
em outra rede. Não substitui o desenho no KiCad com a conferência de fábrica (DRC) nem gera os arquivos Gerber.

Uso: python3 veiculos/fiat-uno-vivace-2012/placa/gerar_pcb.py (o gerar_placa.py também chama este).
"""
import math
import os
import sys

OUT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, OUT)
os.environ['PLACA_VARIANTE'] = 'sn65'
import gerar_placa as gp   # noqa: E402  (posições da placa ilhada, versão SN65HVD230)

P = gp.P
W, H = gp.W, gp.H
hp = gp.hp
S = 11.0          # px por mm
PAD_L, PAD_T = 60, 120   # margens do desenho (px)
FONT = 'DejaVu Sans, Arial, sans-serif'

# ---------------------------------------------------------------- peças (rótulo, coluna, linha, rede, diâmetro, quadrada)
# ESP32: barras nas linhas 2 e 12, colunas 2 a 16 (como na placa ilhada)
NET_OF_ESP = {'D21': 'CRX', 'GND': 'GND', '3V3': '3V3', 'VIN': '5V', 'D34': 'VBAT', 'D25': 'SDA', 'D26': 'SCL'}
NET_OF_ESP.update({gp.LED_ESP[k]: f'LED_{k}' for k in gp.LED_PINS})
pads = []
for i, n in enumerate(gp.ESP_TOP):
    pads.append((n, i + 2, 2, NET_OF_ESP.get(n, 'NC'), 1.7, i == 0))
for i, n in enumerate(gp.ESP_BOT):
    pads.append((n, i + 2, 12, NET_OF_ESP.get(n, 'NC'), 1.7, i == 0))
LED_AT = {v: k for k, v in gp.LED_PINS.items()}
for c, r in gp.LED_HEADER:
    k = LED_AT.get((c, r))
    pads.append(({'COM': 'C'}.get(k, k or ''), c, r, f'LED_{k}' if k else 'NC', 1.6, k == 'COM'))
# R4 (3V3 → CANH) ao lado do USB do ESP32, na coluna 18: na placa ilhada fica na 16, mas aqui o CANH cruzaria o 3V3
R4 = ((18, 3), (18, 7))
pads += [('R4', *R4[0], '3V3', 1.6, False), ('', *R4[1], 'CANH', 1.6, False)]
BUCK_NET = {'EN': 'NC', 'IN-': 'GND', 'IN+': '12VF', 'OUT-': 'GND', 'OUT+': '5V'}
for k, (c, r) in gp.BUCK_PINS.items():
    pads.append((k.replace('-', '−'), c, r, BUCK_NET[k], 1.8, k in ('IN+', 'OUT+')))
pads += [('', *gp.FUSE_PINS['OUT'], '12VF', 2.8, False), ('', *gp.FUSE_PINS['IN'], '12V', 2.8, False)]
OBD_NET = {'16': '12V', '4': 'GND', '5': 'GND', '14': 'CANL'}
for k, (c, r) in gp.OBD_PADS.items():
    pads.append((k, c, r, OBD_NET[k], 2.2, k == '16'))
SN_NET = {'3V3': '3V3', 'GND': 'GND', 'CTX': '3V3', 'CRX': 'CRX', 'CANH': 'CANH', 'CANL': 'CANL'}
for k, (c, r) in gp.SN_PINS.items():
    pads.append((k, c, r, SN_NET[k], 1.6, k == '3V3'))
RES_NET = {'R5': ('12VF', 'VBAT'), 'R6': ('VBAT', 'GND')}
for nome, a, b, _ in gp.RES:
    if nome in RES_NET:
        pads += [(nome, *a, RES_NET[nome][0], 1.6, False), ('', *b, RES_NET[nome][1], 1.6, False)]
for nome, a, b, _ in gp.CAPS:
    pads += [(nome, *a, 'VBAT', 1.5, False), ('', *b, 'GND', 1.5, False)]
# Pontos de teste: os da placa ilhada; o TP3 desce para (11, 19), porque a trilha do 5 V passa onde ele fica lá
TP_NET = {'12 V': '12VF', '5 V': '5V', 'GND': 'GND'}
TP_AT = {'TP3': (11, 19)}
for nome, rot, at, _, _ in gp.TEST_POINTS:
    pads.append((nome, *TP_AT.get(nome, at), TP_NET[rot], 1.9, False))
SENSOR_NET = {'SDA': 'SDA', 'SCL': 'SCL', 'GND': 'GND', 'VCC': '5V'}
SENSORES = [('GY-273', gp.MAG_PINS), ('LSM6DS3', gp.LSM_PINS), ('BMP180', gp.BMP_PINS)]
for nome, pins in SENSORES:
    for k, (c, r) in pins.items():
        pads.append(('', c, r, SENSOR_NET[k], 1.6, k == 'SDA'))
VIAS = [(14.5, 10.5, 'CRX')]

# ---------------------------------------------------------------- trilhas (rede, largura mm, pontos)
TOP = [
    ('12V', 1.0, [(11, 24), (9, 24)]),
    ('12VF', 1.0, [(1, 24), (1, 23), (8, 23), (8, 16)]),
    ('12VF', 0.8, [(8, 23), (11, 23)]),
    ('12VF', 0.5, [(4, 23), (4, 22)]),
    ('5V', 0.8, [(1, 21), (2, 21), (2, 13.3), (16, 13.3), (16, 12)]),
    ('5V', 0.6, [(16, 13.3), (16, 15), (15, 15), (15, 17)]),
    ('3V3', 0.5, [(16, 2), (17, 2), (17, 20), (13, 20), (13, 23)]),
    ('3V3', 0.5, [(17, 2), (18, 2), (18, 3)]),
    ('3V3', 0.4, [(15, 20), (15, 23)]),
    ('CANH', 0.4, [(18, 7), (18, 22), (17, 22), (17, 23)]),
    ('CANL', 0.5, [(18, 23), (18, 24)]),
    ('CRX', 0.3, [(6, 2), (6, 3.5), (14.5, 3.5), (14.5, 10.5)]),
    ('VBAT', 0.3, [(4, 18), (5, 18), (5, 19)]),
] + [(f'LED_{k}', 0.3, [(c, r), (c, r + 1)]) for k, (c, r) in gp.LED_PINS.items()]   # conector do LED → pinos do ESP32
BOTTOM = [
    ('CRX', 0.3, [(14.5, 10.5), (14.5, 21.5), (16, 21.5), (16, 23)]),
    ('VBAT', 0.3, [(5, 12), (5, 18)]),
    ('SDA', 0.3, [(9, 12), (9, 14), (12, 14), (12, 17)]),
    ('SCL', 0.3, [(10, 12), (10, 13.5), (13, 13.5), (13, 17)]),
]
CLEAR = 0.35   # folga do plano de GND (mm)

# ---------------------------------------------------------------- serigrafia da face de cima (contornos dos módulos)
# (rótulo, x, y, largura, altura) em mm
x2, y2 = hp(2, 2)
SILK = [
    ('ESP32 DevKit V1 (barras fêmea)', x2 - 9.5, y2 - 1.3, 50.0, 28.0),
    ('RT8272 5 V', hp(1, 14)[0] - 1.5, hp(1, 14)[1] - 1.5, 21.0, 21.0),
    ('Fusível 1,5 A (AS-06)', hp(5, 24)[0] - 13.0, hp(5, 24)[1] - 4.8, 26.0, 9.6),
    ('SN65HVD230', hp(13, 23)[0] - 1.2, hp(13, 23)[1] - 13.9 + 1.2, 15.7, 13.9),
]
NET_COL = {'12V': '#ff7043', '12VF': '#ab47bc', '5V': '#ef5350', '3V3': '#ffa726', 'GND': '#90a4ae', 'CANH': '#42a5f5',
           'CANL': '#29b6f6', 'CRX': '#ffee58', 'SDA': '#26c6da', 'SCL': '#66bb6a', 'VBAT': '#a1887f'}


class Svg:
    def __init__(self, title, sub):
        self.w = PAD_L * 2 + W * S + 300
        self.h = PAD_T + H * S + 70
        self.o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w:.0f}" height="{self.h:.0f}" '
                  f'viewBox="0 0 {self.w:.0f} {self.h:.0f}" font-family="{FONT}">',
                  f'<rect width="100%" height="100%" fill="#f4f6f8"/>',
                  f'<text x="{PAD_L}" y="46" font-size="24" font-weight="bold" fill="#1d2733">{title}</text>',
                  f'<text x="{PAD_L}" y="76" font-size="14" fill="#4b5a6b">{sub}</text>']

    def X(self, x):
        return PAD_L + x * S

    def Y(self, y):
        return PAD_T + y * S

    def add(self, s):
        self.o.append(s)

    def path(self, pts, color, width, cap='round', mirror=False):
        d = ' '.join(('M' if i == 0 else 'L') + f'{self.X(self.mx(x, mirror)):.1f},{self.Y(y):.1f}' for i, (x, y) in enumerate(pts))
        self.add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width * S:.1f}" stroke-linecap="{cap}" stroke-linejoin="round"/>')

    @staticmethod
    def mx(x, mirror):
        return W - x if mirror else x

    def save(self, name):
        self.add('</svg>')
        open(os.path.join(OUT, name), 'w').write('\n'.join(self.o))


def mm(pts):
    return [hp(c, r) for c, r in pts]


MASK, MASK_DARK, COPPER, PAD, SILKC, HOLE = '#1f6b3a', '#174f2b', '#3f9a5c', '#d9d9d9', '#ffffff', '#0d1117'


def board(s, mirror):
    s.add(f'<rect x="{s.X(0)}" y="{s.Y(0)}" width="{W * S}" height="{H * S}" rx="{2 * S}" fill="{MASK}" stroke="#0f3a20" stroke-width="2"/>')
    # apoios dos cantos da caixa: sem cobre
    for cx, cy in [(2.5, 2.5), (W - 2.5, 2.5), (2.5, H - 2.5), (W - 2.5, H - 2.5)]:
        s.add(f'<circle cx="{s.X(cx)}" cy="{s.Y(cy)}" r="{2.2 * S}" fill="none" stroke="{SILKC}" stroke-width="1" stroke-dasharray="3 3" opacity=".7"/>')


def draw_pads(s, mirror, show_labels):
    for lab, c, r, net, d, sq in pads:
        x, y = hp(c, r)
        X, Y = s.X(s.mx(x, mirror)), s.Y(y)
        rr = d / 2 * S
        if sq:
            s.add(f'<rect x="{X - rr:.1f}" y="{Y - rr:.1f}" width="{2 * rr:.1f}" height="{2 * rr:.1f}" fill="{PAD}"/>')
        else:
            s.add(f'<circle cx="{X:.1f}" cy="{Y:.1f}" r="{rr:.1f}" fill="{PAD}"/>')
        drill = 1.5 if d >= 2.8 else 1.0 if d >= 2.0 else 0.9
        s.add(f'<circle cx="{X:.1f}" cy="{Y:.1f}" r="{drill / 2 * S:.1f}" fill="{HOLE}"/>')
    for x, y, net in VIAS:
        xx, yy = hp(x, y)
        s.add(f'<circle cx="{s.X(s.mx(xx, mirror)):.1f}" cy="{s.Y(yy):.1f}" r="{0.4 * S:.1f}" fill="{PAD}"/>')
        s.add(f'<circle cx="{s.X(s.mx(xx, mirror)):.1f}" cy="{s.Y(yy):.1f}" r="{0.15 * S:.1f}" fill="{HOLE}"/>')


def legend(s, items, x0):
    y = PAD_T + 10
    s.add(f'<text x="{x0}" y="{y}" font-size="15" font-weight="bold" fill="#1d2733">Redes</text>')
    for net, txt in items:
        y += 26
        s.add(f'<rect x="{x0}" y="{y - 12}" width="22" height="12" rx="3" fill="{NET_COL[net]}"/>')
        s.add(f'<text x="{x0 + 30}" y="{y - 1}" font-size="13" fill="#1d2733">{txt}</text>')
    return y


def top():
    s = Svg('PCB de duas faces: face de cima (componentes)',
            'Exemplo de versão 2 para fábrica · 50 × 70 mm, posições da placa ilhada · SN65HVD230 · trilhas coloridas por rede')
    board(s, False)
    for net, w, pts in TOP:
        s.path(mm(pts), NET_COL[net] if net in NET_COL else '#e0e0e0', w)
    draw_pads(s, False, True)
    # serigrafia
    for lab, x, y, w, h in SILK:
        s.add(f'<rect x="{s.X(x):.1f}" y="{s.Y(y):.1f}" width="{w * S:.1f}" height="{h * S:.1f}" rx="4" fill="none" stroke="{SILKC}" stroke-width="1.4" opacity=".85"/>')
    lab = [('ESP32 DevKit V1 (barras fêmea)', 9, 7.3), ('antena: fora da placa ←', 4.2, 9.3), ('RT8272 5 V', 4.5, 17.2),
           ('Fusível 1,5 A', 5, 25.6), ('SN65HVD230', 15.5, 21.4), ('OBD', 15.5, 24.9),
           ('GY-273', 10.2, 15), ('LSM6DS3', 10.2, 16), ('BMP180', 10.2, 17), ('LED RGB', 6.2, 1)]
    for t, c, r in lab:
        x, y = hp(c, r)
        s.add(f'<text x="{s.X(x):.1f}" y="{s.Y(y) + 4:.1f}" font-size="11" fill="{SILKC}" text-anchor="middle" font-weight="bold">{t}</text>')
    for lab_, c, r, net, d, sq in pads:
        if lab_.startswith('TP') or lab_ in ('R4', 'R5', 'R6', 'C1'):
            x, y = hp(c, r)
            s.add(f'<text x="{s.X(x) + 13:.1f}" y="{s.Y(y) + 4:.1f}" font-size="10.5" fill="#fff59d" font-weight="bold">{lab_}</text>')
    for lab_, c, r, net, d, sq in pads:
        if lab_ in ('16', '4', '5', '14'):
            x, y = hp(c, r)
            s.add(f'<text x="{s.X(x):.1f}" y="{s.Y(y) + 26:.1f}" font-size="10" fill="{SILKC}" text-anchor="middle">{lab_}</text>')
    y = legend(s, [('12V', '12 V do OBD (pino 16), antes do fusível'), ('12VF', '12 V depois do fusível'),
                   ('5V', '5 V do RT8272'), ('3V3', '3,3 V do ESP32 (e CTX preso)'), ('CANH', 'CANH (3,3 V por R4)'),
                   ('CANL', 'CANL → OBD pino 14'), ('CRX', 'CRX → D21 (passa por baixo)'),
                   ('VBAT', 'divisor da bateria → D34')], PAD_L + W * S + 30)
    s.add(f'<text x="{PAD_L + W * S + 30}" y="{y + 40}" font-size="12" fill="#4b5a6b">'
          f'<tspan x="{PAD_L + W * S + 30}" dy="0">Cinza claro: ilhas (furo metalizado).</tspan>'
          f'<tspan x="{PAD_L + W * S + 30}" dy="18">Quadrada: pino 1.</tspan>'
          f'<tspan x="{PAD_L + W * S + 30}" dy="18">Ponto pequeno: via (passa de face).</tspan>'
          f'<tspan x="{PAD_L + W * S + 30}" dy="18">Tracejado nos cantos: apoios</tspan>'
          f'<tspan x="{PAD_L + W * S + 30}" dy="18">da caixa, sem cobre.</tspan>'
          f'<tspan x="{PAD_L + W * S + 30}" dy="18">Trilhas: 1,0 mm (12 V), 0,8 mm (5 V),</tspan>'
          f'<tspan x="{PAD_L + W * S + 30}" dy="18">0,3 a 0,5 mm (sinais).</tspan></text>')
    s.save('pcb-cima.svg')


def bottom():
    s = Svg('PCB de duas faces: face de baixo (vista por baixo, espelhada)',
            'Plano de GND em toda a face · só 4 trilhas de sinal cruzam por baixo · ilhas de GND com alívio térmico')
    mirror = True
    board(s, mirror)
    # plano de GND (cobre) com recuo da borda
    s.add(f'<rect x="{s.X(0.6)}" y="{s.Y(0.6)}" width="{(W - 1.2) * S}" height="{(H - 1.2) * S}" rx="{1.6 * S}" fill="{COPPER}"/>')
    for cx, cy in [(2.5, 2.5), (W - 2.5, 2.5), (2.5, H - 2.5), (W - 2.5, H - 2.5)]:
        s.add(f'<circle cx="{s.X(cx)}" cy="{s.Y(cy)}" r="{2.2 * S}" fill="{MASK}"/>')
    # recortes: folga em volta das trilhas de baixo e dos pads que não são GND
    for net, w, pts in BOTTOM:
        s.path([(x, y) for x, y in mm(pts)], MASK, w + 2 * CLEAR, mirror=mirror)
    for lab, c, r, net, d, sq in pads:
        x, y = hp(c, r)
        X, Y = s.X(s.mx(x, mirror)), s.Y(y)
        if net != 'GND':
            rr = (d / 2 + CLEAR) * S
            if sq:
                s.add(f'<rect x="{X - rr:.1f}" y="{Y - rr:.1f}" width="{2 * rr:.1f}" height="{2 * rr:.1f}" fill="{MASK}"/>')
            else:
                s.add(f'<circle cx="{X:.1f}" cy="{Y:.1f}" r="{rr:.1f}" fill="{MASK}"/>')
        else:   # alívio térmico: anel de folga com 4 raios
            rr = (d / 2 + CLEAR) * S
            s.add(f'<circle cx="{X:.1f}" cy="{Y:.1f}" r="{rr:.1f}" fill="{MASK}"/>')
            for a in (0, 90, 180, 270):
                ex, ey = X + math.cos(math.radians(a)) * (rr + 1), Y + math.sin(math.radians(a)) * (rr + 1)
                s.add(f'<line x1="{X:.1f}" y1="{Y:.1f}" x2="{ex:.1f}" y2="{ey:.1f}" stroke="{COPPER}" stroke-width="{0.45 * S:.1f}"/>')
    for x, y, net in VIAS:
        xx, yy = hp(x, y)
        s.add(f'<circle cx="{s.X(s.mx(xx, mirror)):.1f}" cy="{s.Y(yy):.1f}" r="{(0.4 + CLEAR) * S:.1f}" fill="{MASK}"/>')
    for net, w, pts in BOTTOM:
        s.path(mm(pts), NET_COL[net], w, mirror=mirror)
    draw_pads(s, mirror, False)
    # rótulos
    for t, c, r in [('OBD', 15.5, 25.2), ('GND (plano)', 4, 7), ('SN65', 15.5, 21.6)]:
        x, y = hp(c, r)
        s.add(f'<text x="{s.X(s.mx(x, mirror)):.1f}" y="{s.Y(y) + 4:.1f}" font-size="11" fill="{SILKC}" text-anchor="middle" font-weight="bold">{t}</text>')
    for lab_, c, r, net, d, sq in pads:
        if lab_ in ('16', '4', '5', '14'):
            x, y = hp(c, r)
            s.add(f'<text x="{s.X(s.mx(x, mirror)):.1f}" y="{s.Y(y) + 26:.1f}" font-size="10" fill="{SILKC}" text-anchor="middle">{lab_}</text>')
    y = legend(s, [('GND', 'plano de GND (cobre)'), ('SDA', 'SDA: D25 → sensores'), ('SCL', 'SCL: D26 → sensores'),
                   ('VBAT', 'D34 → divisor da bateria'), ('CRX', 'CRX: D21 → SN65HVD230')], PAD_L + W * S + 30)
    s.add(f'<text x="{PAD_L + W * S + 30}" y="{y + 40}" font-size="12" fill="#4b5a6b">'
          f'<tspan x="{PAD_L + W * S + 30}" dy="0">Espelhada: é como se vê</tspan>'
          f'<tspan x="{PAD_L + W * S + 30}" dy="18">virando a placa (o OBD fica</tspan>'
          f'<tspan x="{PAD_L + W * S + 30}" dy="18">embaixo à esquerda).</tspan>'
          f'<tspan x="{PAD_L + W * S + 30}" dy="18">Verde-escuro: sem cobre.</tspan></text>')
    s.save('pcb-baixo.svg')



def check():
    """Conferência simples: trilha que não começa nem termina numa ilha, via ou outra trilha da mesma rede, ou que passa
    perto demais de uma ilha de outra rede na mesma face (todas as ilhas são de furo, nas duas faces)."""
    def seg_dist(p, a, b):
        (px, py), (ax, ay), (bx, by) = p, a, b
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
        return math.hypot(px - ax - t * dx, py - ay - t * dy)
    erros = []
    for face, tracks in (('cima', TOP), ('baixo', BOTTOM)):
        for net, w, pts in tracks:
            seg = list(zip(mm(pts), mm(pts)[1:]))
            for lab, c, r, pnet, d, sq in pads:
                if pnet == net:
                    continue
                p = hp(c, r)
                if any(seg_dist(p, a, b) < d / 2 + w / 2 + 0.2 for a, b in seg):
                    erros.append(f'{face}: trilha {net} {pts} encosta na ilha ({c}, {r}) da rede {pnet}')
            for end in (pts[0], pts[-1]):
                e = hp(*end)
                ok = any(pnet == net and math.dist(e, hp(c, r)) < 0.01 for _, c, r, pnet, _, _ in pads)
                ok = ok or any(vn == net and math.dist(e, hp(vx, vy)) < 0.01 for vx, vy, vn in VIAS)
                ok = ok or any(n2 == net and (n2, w2, p2) != (net, w, pts) and
                               any(seg_dist(e, a, b) < 0.01 for a, b in zip(mm(p2), mm(p2)[1:]))
                               for n2, w2, p2 in tracks)
                if not ok:
                    erros.append(f'{face}: ponta solta da trilha {net} em {end}')
    if erros:
        sys.exit('PCB: ' + '; '.join(erros))


def main():
    check()
    top()
    bottom()
    print('ok: pcb-cima.svg, pcb-baixo.svg')


if __name__ == '__main__':
    main()
