#!/usr/bin/env python3
"""Caixa de proteção da placa da escuta CAN (Uno Vivace), para impressora 3D.

Uma lista de peças simples (blocos, cilindros, anéis e placas com furo) descreve a base e a tampa. Dela saem:
- caixa-base.stl e caixa-tampa.stl: prontos para fatiar (a tampa já vem virada, com a face de cima na mesa);
- caixa.scad: a mesma caixa no OpenSCAD, com operações de verdade (difference e union);
- caixa.svg: desenho com as cotas, ao lado do esquema no README;
- o bloco 'caixa' em modelo3d-dados.js, para o visor do painel (/projeto/placa) mostrar a placa dentro ou fora dela.

Peças sobrepostas nos STL são normais: os fatiadores (PrusaSlicer, Cura, Bambu Studio, OrcaSlicer) juntam os volumes.
Coordenadas como as da placa: x para a direita, y para baixo (linha 1 em cima), z para cima, em mm; a face de cima
da placa perfurada fica em z = 1,6 e a de baixo em z = 0. Gerado por gerar_3d.py (que importa este arquivo).

Escolhas do Alan (10/11/2026): o LSM6DS3 e o BMP180 ficam dentro, cada um preso num apoio do fundo (o BMP180 começou
fora e entrou a pedido dele); tampa com 4 parafusos M3; abas com furo para prender no carro; abertura para o USB do ESP32.
"""
import math
import os
import struct

# ---------------------------------------------------------------- Medidas (mm)
PAREDE = 2.0                 # paredes laterais
FUNDO = 2.0                  # fundo
TAMPA = 2.0                  # tampa
# Espaço interno: a placa (50 x 70) com a antena do ESP32 à esquerda, o LSM6DS3 à direita e os fios do cabo OBD embaixo
INT = {'x0': -2.5, 'y0': -2.0, 'x1': 68.5, 'y1': 80.5}
PISO_Z = -5.5                # face de cima do fundo: a placa fica 5,5 mm acima, nos apoios dos cantos
TOPO_Z = 20.0                # topo das paredes = face de baixo da tampa (o ESP32 vai até 17,2)
FOLGA = 0.3                  # folga entre peças que encaixam

# Torres dos parafusos da tampa, por fora dos cantos: furo-guia de 2,6 mm para parafuso M3 (rosqueia no plástico)
TORRE_R = 4.0
TORRE_DIAG = 2.5             # centro a 2,5 mm do canto de fora, nas duas direções
GUIA_R = 1.3                 # furo-guia (M3 autoatarraxante ou M3 comum rosqueando o plástico)
GUIA_FUNDO = 12.0            # profundidade do furo-guia
PASSA_R = 1.7                # furo de passagem na tampa (3,4 mm)

# Abas para prender no carro (parafuso M4 ou abraçadeira de até 4 mm)
# Abas para prender no carro: furo para parafuso M4 e, mais para fora, fenda para abraçadeira de nylon (tipo Hellermann)
# de até 5 mm de largura. Dá para usar um, outro ou os dois.
ABA = {'sai': 18.5, 'largura': 16.0, 'esp': 3.0, 'furo_r': 2.25, 'furo_dist': 7.0, 'furo_lado': 10.0,
       'fenda_dist': 14.6, 'fenda_x': 2.2, 'fenda_y': 5.4}

# Apoios da placa nos cantos (por baixo) e guias em L por fora dos cantos
APOIO = 3.5
GUIA_ESP, GUIA_BRACO = 1.2, 2.4
GUIA_TOPO = 1.6 + 0.8        # 0,8 mm acima da face de cima da placa

# Batentes da tampa: param a placa (e a tampa do fusível) com 0,3 mm de folga, sem apertar
BATENTE_R = 1.5


def outer():
    return {'x0': INT['x0'] - PAREDE, 'y0': INT['y0'] - PAREDE, 'x1': INT['x1'] + PAREDE, 'y1': INT['y1'] + PAREDE,
            'z0': PISO_Z - FUNDO, 'z1': TOPO_Z + TAMPA}


def torres():
    o = outer()
    d = TORRE_DIAG
    return [(o['x0'] - d, o['y0'] - d), (o['x1'] + d, o['y0'] - d), (o['x0'] - d, o['y1'] + d), (o['x1'] + d, o['y1'] + d)]


# ---------------------------------------------------------------- Peças
def bx(x0, y0, z0, x1, y1, z1, nome=None):
    return {'t': 'box', 'a': [min(x0, x1), min(y0, y1), min(z0, z1)], 'b': [max(x0, x1), max(y0, y1), max(z0, z1)], 'n': nome}


def cil(cx, cy, z0, z1, r, nome=None):
    return {'t': 'cil', 'c': [cx, cy], 'z': [z0, z1], 'r': r, 'n': nome}


def anel(cx, cy, z0, z1, ri, ro, nome=None):
    return {'t': 'anel', 'c': [cx, cy], 'z': [z0, z1], 'ri': ri, 'r': ro, 'n': nome}


def furada(cx, cy, z0, z1, w, h, r, nome=None):
    """Placa w x h centrada no furo de raio r."""
    return {'t': 'furada', 'c': [cx, cy], 'z': [z0, z1], 'w': w, 'h': h, 'ri': r, 'n': nome}


def parede(eixo, fixo0, fixo1, ini, fim, z0, z1, aberturas, nome):
    """Parede ao longo de 'x' ou 'y', de ini a fim, com aberturas [(centro, largura, z_baixo, z_alto)] recortadas."""
    out = []
    cortes = sorted(aberturas)
    pos = ini
    for c, w, zb, za in cortes:
        a, b = c - w / 2, c + w / 2
        if a > pos:
            out.append((pos, a, z0, z1))
        out.append((a, b, z0, zb))
        if za < z1:
            out.append((a, b, za, z1))
        pos = b
    if pos < fim:
        out.append((pos, fim, z0, z1))
    pecas = []
    for a, b, za, zb in out:
        if zb - za < 1e-6:
            continue
        if eixo == 'x':
            pecas.append(bx(a, fixo0, za, b, fixo1, zb, nome))
        else:
            pecas.append(bx(fixo0, a, za, fixo1, b, zb, nome))
    return pecas


def chapa_furada(x0, y0, x1, y1, z0, z1, furos, nome):
    """Chapa com furos redondos: cada furo numa placa quadrada com furo; o resto em blocos ao redor."""
    quad = []
    pecas = []
    for cx, cy, r, n in furos:
        lado = 2 * r + 4.0
        quad.append((cx - lado / 2, cy - lado / 2, cx + lado / 2, cy + lado / 2))
        pecas.append(furada(cx, cy, z0, z1, lado, lado, r, n))
    xs = sorted({x0, x1, *[q[0] for q in quad], *[q[2] for q in quad]})
    ys = sorted({y0, y1, *[q[1] for q in quad], *[q[3] for q in quad]})
    for a, b in zip(xs, xs[1:]):
        for c, d in zip(ys, ys[1:]):
            mx, my = (a + b) / 2, (c + d) / 2
            if not any(q[0] < mx < q[2] and q[1] < my < q[3] for q in quad):
                pecas.append(bx(a, c, z0, b, d, z1, nome))
    return pecas


def montar(ref):
    """ref: posições vindas do modelo da placa (gerar_3d.py).

    usb_y, usb_z: centro do micro-USB do ESP32; obd_y, obd_z, obd_r: centro e raio da capa do cabo OBD na parede
    direita; apoios: [(módulo (x0, y0, l, w, z0), início do apoio a partir de x0, nome)] dos sensores dentro da caixa;
    fusivel: centro (x, y) e topo da tampa do suporte AS-06; placa: (W, H, T).
    """
    o = outer()
    W, H, T = ref['placa']
    base, tampa = [], []

    # Fundo e paredes (as aberturas ficam na parede direita, por onde saem o USB e os dois cabos)
    base.append(bx(o['x0'], o['y0'], o['z0'], o['x1'], o['y1'], PISO_Z, 'Fundo da caixa'))
    usb = (ref['usb_y'], 13.0, ref['usb_z'] - 4.5, TOPO_Z + 1)
    obd = (ref['obd_y'], 2 * ref['obd_r'] + 0.6, ref['obd_z'] - ref['obd_r'] - 0.3, TOPO_Z + 1)
    ABERT = {'usb': usb, 'obd': obd}
    base += parede('y', INT['x1'], o['x1'], o['y0'], o['y1'], PISO_Z, TOPO_Z, [usb, obd], 'Parede direita (USB e cabo OBD)')
    base += parede('y', o['x0'], INT['x0'], o['y0'], o['y1'], PISO_Z, TOPO_Z, [], 'Parede esquerda')
    base += parede('x', o['y0'], INT['y0'], INT['x0'], INT['x1'], PISO_Z, TOPO_Z, [], 'Parede de cima')
    base += parede('x', INT['y1'], o['y1'], INT['x0'], INT['x1'], PISO_Z, TOPO_Z, [], 'Parede de baixo')

    # Torres dos parafusos (por fora dos cantos): maciças embaixo, com o furo-guia em cima
    for cx, cy in torres():
        base.append(cil(cx, cy, o['z0'], TOPO_Z - GUIA_FUNDO, TORRE_R, 'Torre do parafuso M3 da tampa'))
        base.append(anel(cx, cy, TOPO_Z - GUIA_FUNDO, TOPO_Z, GUIA_R, TORRE_R, 'Torre do parafuso M3 da tampa (furo-guia de 2,6 mm)'))

    # Abas de fixação, rentes ao fundo, no meio das paredes esquerda e direita
    cy = (o['y0'] + o['y1']) / 2
    for lado in (-1, 1):
        parede_x = o['x0'] if lado < 0 else o['x1']
        fx = parede_x + lado * ABA['furo_dist']
        z0, z1 = o['z0'], o['z0'] + ABA['esp']
        hw = ABA['largura'] / 2
        nome = 'Aba de fixação (furo de 4,5 mm para parafuso M4 e fenda para abraçadeira de até 5 mm)'
        base.append(furada(fx, cy, z0, z1, ABA['furo_lado'], ABA['largura'], ABA['furo_r'], nome))
        # liga a placa com furo à parede
        base.append(bx(parede_x - lado * 0.5, cy - hw, z0, fx - lado * ABA['furo_lado'] / 2, cy + hw, z1, nome))
        # ponta com a fenda da abraçadeira (atravessada, paralela à parede)
        ini, fim = fx + lado * ABA['furo_lado'] / 2, parede_x + lado * ABA['sai']
        fc = parede_x + lado * ABA['fenda_dist']
        fa, fb = fc - lado * ABA['fenda_x'] / 2, fc + lado * ABA['fenda_x'] / 2
        fy = ABA['fenda_y'] / 2
        base.append(bx(ini, cy - hw, z0, fa, cy + hw, z1, nome))
        base.append(bx(fb, cy - hw, z0, fim, cy + hw, z1, nome))
        base.append(bx(fa, cy - hw, z0, fb, cy - fy, z1, nome))
        base.append(bx(fa, cy + fy, z0, fb, cy + hw, z1, nome))

    # Apoios da placa nos 4 cantos, com guias em L por fora
    for sx, sy in ((0, 0), (1, 0), (0, 1), (1, 1)):
        x = 0 if sx == 0 else W - APOIO
        y = 0 if sy == 0 else H - APOIO
        base.append(bx(x, y, PISO_Z, x + APOIO, y + APOIO, 0, 'Apoio da placa'))
        gx0 = -FOLGA - GUIA_ESP if sx == 0 else W + FOLGA
        gy0 = -FOLGA - GUIA_ESP if sy == 0 else H + FOLGA
        bx_ = (0, GUIA_BRACO) if sx == 0 else (W - GUIA_BRACO, W)
        by_ = (0, GUIA_BRACO) if sy == 0 else (H - GUIA_BRACO, H)
        base.append(bx(gx0, min(gy0, by_[0]), PISO_Z, gx0 + GUIA_ESP, max(gy0 + GUIA_ESP, by_[1]), GUIA_TOPO, 'Guia do canto da placa'))
        base.append(bx(min(gx0, bx_[0]), gy0, PISO_Z, max(gx0 + GUIA_ESP, bx_[1]), gy0 + GUIA_ESP, GUIA_TOPO, 'Guia do canto da placa'))

    # Apoios dos sensores: bloco embaixo do lado sem barra; o módulo fica preso com fita dupla-face e o cabo passa por baixo
    for L, ini, nome in ref['apoios']:
        base.append(bx(L['x0'] + ini, L['y0'], PISO_Z, L['x0'] + L['l'], L['y0'] + L['w'], L['z0'], f'Apoio do {nome} (fita dupla-face)'))

    # Tampa: chapa, orelhas dos parafusos, aba interna que centraliza e linguetas que fecham as aberturas dos cabos
    tampa += chapa_furada(o['x0'], o['y0'], o['x1'], o['y1'], TOPO_Z, o['z1'], ref.get('furos_tampa', []), 'Tampa')
    for cx_, cy_ in torres():
        tampa.append(anel(cx_, cy_, TOPO_Z, o['z1'], PASSA_R, TORRE_R, 'Tampa: furo do parafuso M3 (3,4 mm)'))
    aba_esp, aba_h = 1.2, 2.0
    ix0, iy0, ix1, iy1 = INT['x0'] + FOLGA, INT['y0'] + FOLGA, INT['x1'] - FOLGA, INT['y1'] - FOLGA
    cortes_dir = [(c, w + 2, 0, TOPO_Z + 5) for c, w, _, _ in ABERT.values()]
    tampa += parede('y', ix1 - aba_esp, ix1, iy0, iy1, TOPO_Z - aba_h, TOPO_Z, cortes_dir, 'Tampa: aba de encaixe')
    tampa += parede('y', ix0, ix0 + aba_esp, iy0, iy1, TOPO_Z - aba_h, TOPO_Z, [], 'Tampa: aba de encaixe')
    tampa += parede('x', iy0, iy0 + aba_esp, ix0 + aba_esp, ix1 - aba_esp, TOPO_Z - aba_h, TOPO_Z, [], 'Tampa: aba de encaixe')
    tampa += parede('x', iy1 - aba_esp, iy1, ix0 + aba_esp, ix1 - aba_esp, TOPO_Z - aba_h, TOPO_Z, [], 'Tampa: aba de encaixe')
    # linguetas: descem pela abertura até encostar no cabo (o USB fica livre)
    for chave, nome, fundo in (('obd', 'Tampa: lingueta do cabo OBD', ref['obd_z'] + ref['obd_r'] + 0.3),):
        c, w, _, _ = ABERT[chave]
        tampa.append(bx(INT['x1'], c - w / 2 + 0.2, fundo, o['x1'], c + w / 2 - 0.2, TOPO_Z, nome))
    # batentes: dois cantos de cima da placa, o canto de baixo à direita e a tampa do fusível
    for x, y, r in ((2.0, 2.0, BATENTE_R), (W - 2.0, 2.0, BATENTE_R), (W - 1.2, H - 1.2, 1.2)):
        tampa.append(cil(x, y, T + FOLGA, TOPO_Z, r, 'Tampa: batente da placa'))
    fx, fy, ftop = ref['fusivel']
    tampa.append(bx(fx - 3, fy - 2, ftop + FOLGA, fx + 3, fy + 2, TOPO_Z, 'Tampa: batente do suporte do fusível'))

    for p in base + tampa:
        for k in ('a', 'b', 'c', 'z'):
            if k in p:
                p[k] = [round(v, 3) for v in p[k]]
        for k in ('r', 'ri', 'w', 'h'):
            if k in p:
                p[k] = round(p[k], 3)
    medidas = {
        'externa': [round(o['x1'] - o['x0'], 2), round(o['y1'] - o['y0'], 2), round(o['z1'] - o['z0'], 2)],
        'interna': [round(INT['x1'] - INT['x0'], 2), round(INT['y1'] - INT['y0'], 2), round(TOPO_Z - PISO_Z, 2)],
        'parede': PAREDE, 'fundo': FUNDO, 'tampa': TAMPA,
        'torres': [[round(a, 2) for a in t] for t in torres()],
        'aberturas': {k: {'centro_y': round(v[0], 2), 'largura': round(v[1], 2), 'z_baixo': round(v[2], 2)} for k, v in ABERT.items()},
    }
    return {'base': base, 'tampa': tampa, 'medidas': medidas, 'externa': o, 'interna': {**INT, 'z0': PISO_Z, 'z1': TOPO_Z}}


# ---------------------------------------------------------------- Malha (STL)
# Converte para coordenadas de mão direita (y para cima): y -> -y. Faces no sentido anti-horário visto de fora.
N_CIRC = 64


def _circ(cx, cy, r, angs):
    return [(cx + r * math.cos(a), cy + r * math.sin(a)) for a in angs]


def _prisma(poly, z0, z1):
    """Polígono convexo anti-horário extrudado de z0 a z1."""
    tris = []
    n = len(poly)
    for i in range(1, n - 1):
        a, b, c = poly[0], poly[i], poly[i + 1]
        tris.append(((a[0], a[1], z1), (b[0], b[1], z1), (c[0], c[1], z1)))
        tris.append(((a[0], a[1], z0), (c[0], c[1], z0), (b[0], b[1], z0)))
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        tris.append(((p[0], p[1], z0), (q[0], q[1], z0), (q[0], q[1], z1)))
        tris.append(((p[0], p[1], z0), (q[0], q[1], z1), (p[0], p[1], z1)))
    return tris


def _anel(fora, dentro, z0, z1):
    """Contorno de fora e furo de dentro com o mesmo número de pontos, nos mesmos ângulos, anti-horários."""
    tris = []
    n = len(fora)
    for i in range(n):
        j = (i + 1) % n
        o0, o1, i0, i1 = fora[i], fora[j], dentro[i], dentro[j]
        tris.append(((o0[0], o0[1], z1), (o1[0], o1[1], z1), (i1[0], i1[1], z1)))
        tris.append(((o0[0], o0[1], z1), (i1[0], i1[1], z1), (i0[0], i0[1], z1)))
        tris.append(((o0[0], o0[1], z0), (i1[0], i1[1], z0), (o1[0], o1[1], z0)))
        tris.append(((o0[0], o0[1], z0), (i0[0], i0[1], z0), (i1[0], i1[1], z0)))
        tris.append(((o0[0], o0[1], z0), (o1[0], o1[1], z0), (o1[0], o1[1], z1)))
        tris.append(((o0[0], o0[1], z0), (o1[0], o1[1], z1), (o0[0], o0[1], z1)))
        tris.append(((i1[0], i1[1], z0), (i0[0], i0[1], z0), (i0[0], i0[1], z1)))
        tris.append(((i1[0], i1[1], z0), (i0[0], i0[1], z1), (i1[0], i1[1], z1)))
    return tris


def malha(p):
    """Triângulos de uma peça, já com y para cima."""
    if p['t'] == 'box':
        (x0, y0, z0), (x1, y1, z1) = p['a'], p['b']
        return _prisma([(x0, -y1), (x1, -y1), (x1, -y0), (x0, -y0)], z0, z1)
    cx, cy = p['c'][0], -p['c'][1]
    z0, z1 = p['z']
    angs = [2 * math.pi * i / N_CIRC for i in range(N_CIRC)]
    if p['t'] == 'cil':
        return _prisma(_circ(cx, cy, p['r'], angs), z0, z1)
    if p['t'] == 'anel':
        return _anel(_circ(cx, cy, p['r'], angs), _circ(cx, cy, p['ri'], angs), z0, z1)
    # placa com furo: contorno retangular amostrado nos mesmos ângulos do furo, com os 4 cantos incluídos
    hw, hh = p['w'] / 2, p['h'] / 2
    ca = math.atan2(hh, hw)
    angs = sorted(set(angs) | {ca, math.pi - ca, math.pi + ca, 2 * math.pi - ca})
    fora = []
    for a in angs:
        c, s = math.cos(a), math.sin(a)
        t = min(hw / abs(c) if abs(c) > 1e-12 else 1e9, hh / abs(s) if abs(s) > 1e-12 else 1e9)
        fora.append((cx + t * c, cy + t * s))
    return _anel(fora, _circ(cx, cy, p['ri'], angs), z0, z1)


def write_stl(path, tris, nome):
    with open(path, 'wb') as fh:
        fh.write(nome.encode('ascii', 'replace')[:80].ljust(80, b' '))
        fh.write(struct.pack('<I', len(tris)))
        for a, b, c in tris:
            u = [b[i] - a[i] for i in range(3)]
            v = [c[i] - a[i] for i in range(3)]
            n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
            ln = math.sqrt(sum(k * k for k in n)) or 1.0
            fh.write(struct.pack('<12fH', *(k / ln for k in n), *a, *b, *c, 0))


def para_mesa(tris, virar=False):
    """Encosta na mesa (z mínimo = 0) e centraliza em x e y; virar gira 180° em torno de x (a tampa de cabeça para baixo)."""
    if virar:
        tris = [tuple((x, -y, -z) for x, y, z in t) for t in tris]
    pts = [q for t in tris for q in t]
    mx = (min(q[0] for q in pts) + max(q[0] for q in pts)) / 2
    my = (min(q[1] for q in pts) + max(q[1] for q in pts)) / 2
    mz = min(q[2] for q in pts)
    return [tuple((x - mx, y - my, z - mz) for x, y, z in t) for t in tris]


# ---------------------------------------------------------------- OpenSCAD
def _scad_peca(p):
    if p['t'] == 'box':
        (x0, y0, z0), (x1, y1, z1) = p['a'], p['b']
        return f'translate([{x0:g}, {-y1:g}, {z0:g}]) cube([{x1 - x0:.3f}, {y1 - y0:.3f}, {z1 - z0:.3f}]);'
    cx, cy = p['c'][0], -p['c'][1]
    z0, z1 = p['z']
    h = z1 - z0
    if p['t'] == 'cil':
        return f'translate([{cx:g}, {cy:g}, {z0:g}]) cylinder(r = {p["r"]:g}, h = {h:.3f});'
    fora = f'cylinder(r = {p["r"]:g}, h = {h:.3f})' if p['t'] == 'anel' else \
        f'translate([{-p["w"] / 2:g}, {-p["h"] / 2:g}, 0]) cube([{p["w"]:g}, {p["h"]:g}, {h:.3f}])'
    return (f'translate([{cx:g}, {cy:g}, {z0:g}]) difference() {{ {fora}; '
            f'translate([0, 0, -0.01]) cylinder(r = {p["ri"]:g}, h = {h + 0.02:.3f}); }}')


def write_scad(path, cx):
    o = cx['externa']
    out = ['// Caixa de proteção da placa da escuta CAN (Uno Vivace).',
           '// Gerado por caixa.py (pela gerar_3d.py): não edite à mão; as medidas ficam no começo de caixa.py.',
           '// F5 mostra a base e a tampa montadas; mude "mostrar" para "base" ou "tampa" e exporte o STL (F6, depois F7).',
           '// Coordenadas em mm: x para a direita, y para cima (o lado do ESP32), z para cima.',
           '',
           'mostrar = "montada";   // "montada", "base", "tampa" (virada para imprimir) ou "explodida"',
           f'$fn = {N_CIRC};',
           '']
    for nome, chave in (('base', 'base'), ('tampa_montada', 'tampa')):
        out.append(f'module {nome}() union() {{')
        out += ['    ' + _scad_peca(p) for p in cx[chave]]
        out.append('}')
        out.append('')
    out += [f'module tampa_para_imprimir() translate([0, 0, {o["z1"]:g}]) rotate([180, 0, 0]) tampa_montada();', '',
            'if (mostrar == "base") base();',
            'else if (mostrar == "tampa") tampa_para_imprimir();',
            'else if (mostrar == "explodida") { color("#5f6b75") base(); color("#8a96a0", 0.9) translate([0, 0, 40]) tampa_montada(); }',
            'else { color("#5f6b75") base(); color("#8a96a0", 0.6) tampa_montada(); }']
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(out) + '\n')


# ---------------------------------------------------------------- Desenho com cotas (SVG)
class Svg:
    def __init__(self):
        self.el = []

    def add(self, s):
        self.el.append(s)

    def rect(self, x, y, w, h, fill='#cfd8dc', stroke='#37474f', sw=0.25, extra=''):
        self.add(f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{extra}/>')

    def circ(self, x, y, r, fill='#cfd8dc', stroke='#37474f', sw=0.25):
        self.add(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{r:.2f}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')

    def text(self, x, y, s, size=2.6, anchor='middle', color='#263238', weight='normal', rot=0):
        t = f' transform="rotate({rot} {x:.2f} {y:.2f})"' if rot else ''
        s = s.replace('&', '&amp;').replace('<', '&lt;')
        self.add(f'<text x="{x:.2f}" y="{y:.2f}" font-size="{size}" text-anchor="{anchor}" fill="{color}" '
                 f'font-family="Arial, Helvetica, sans-serif" font-weight="{weight}"{t}>{s}</text>')

    def cota_h(self, x0, x1, y, rotulo, ref_y=None):
        """Cota horizontal em y, com linhas de chamada até ref_y."""
        c = '#c62828'
        if ref_y is not None:
            for x in (x0, x1):
                self.add(f'<line x1="{x:.2f}" y1="{ref_y:.2f}" x2="{x:.2f}" y2="{y + (1 if y > ref_y else -1):.2f}" stroke="{c}" stroke-width="0.15"/>')
        self.add(f'<line x1="{x0:.2f}" y1="{y:.2f}" x2="{x1:.2f}" y2="{y:.2f}" stroke="{c}" stroke-width="0.2" marker-start="url(#s)" marker-end="url(#s)"/>')
        self.text((x0 + x1) / 2, y - 0.8, rotulo, 2.4, color=c)

    def cota_v(self, y0, y1, x, rotulo, ref_x=None):
        c = '#c62828'
        if ref_x is not None:
            for y in (y0, y1):
                self.add(f'<line x1="{ref_x:.2f}" y1="{y:.2f}" x2="{x + (1 if x > ref_x else -1):.2f}" y2="{y:.2f}" stroke="{c}" stroke-width="0.15"/>')
        self.add(f'<line x1="{x:.2f}" y1="{y0:.2f}" x2="{x:.2f}" y2="{y1:.2f}" stroke="{c}" stroke-width="0.2" marker-start="url(#s)" marker-end="url(#s)"/>')
        self.text(x - 0.8, (y0 + y1) / 2, rotulo, 2.4, color=c, rot=-90)


def _f(v):
    return f'{v:.1f}'.replace('.', ',').replace(',0', '') if abs(v - round(v)) < 0.05 else f'{v:.1f}'.replace('.', ',')


def write_svg(path, cx, ref):
    o, I = cx['externa'], cx['interna']
    med = cx['medidas']
    s = Svg()
    PAR = '#90a4ae'
    # ---- Vista de cima da base (x, y como na placa)
    ox, oy = 44.0, 30.0                         # deslocamento da vista no desenho
    X = lambda x: ox + (x - o['x0'])           # noqa: E731
    Y = lambda y: oy + (y - o['y0'])           # noqa: E731
    s.text(X((o['x0'] + o['x1']) / 2), oy - 22, 'Base, vista de cima', 3.4, weight='bold')
    for t in torres():
        s.circ(X(t[0]), Y(t[1]), TORRE_R, PAR)
    for p in cx['base']:
        if p['t'] == 'furada':
            s.rect(X(p['c'][0] - p['w'] / 2), Y(p['c'][1] - p['h'] / 2), p['w'], p['h'], PAR, 'none')
        elif p['n'] and p['n'].startswith('Aba'):
            (x0, y0, _), (x1, y1, _) = p['a'], p['b']
            s.rect(X(x0), Y(y0), x1 - x0, y1 - y0, PAR, 'none')
    for lado in (-1, 1):   # contorno das abas
        px = o['x0'] if lado < 0 else o['x1']
        ax = min(px, px + lado * ABA['sai'])
        cy_ = (o['y0'] + o['y1']) / 2
        s.rect(X(ax), Y(cy_ - ABA['largura'] / 2), ABA['sai'], ABA['largura'], 'none', '#37474f', 0.25)
    s.rect(X(o['x0']), Y(o['y0']), o['x1'] - o['x0'], o['y1'] - o['y0'], PAR)
    s.rect(X(I['x0']), Y(I['y0']), I['x1'] - I['x0'], I['y1'] - I['y0'], '#eceff1')
    for p in cx['base']:
        if p['t'] == 'furada':
            s.circ(X(p['c'][0]), Y(p['c'][1]), p['ri'], '#ffffff')
        if p['t'] == 'box' and p['n'] and ('Apoio' in p['n'] or 'Guia' in p['n']):
            (x0, y0, _), (x1, y1, _) = p['a'], p['b']
            s.rect(X(x0), Y(y0), x1 - x0, y1 - y0, '#b0bec5')
    for t in torres():
        s.circ(X(t[0]), Y(t[1]), GUIA_R, '#ffffff')
    # placa, ESP32 e LSM6DS3 tracejados, para orientar
    W, H, _ = ref['placa']
    s.rect(X(0), Y(0), W, H, 'none', '#8d6e63', 0.3, ' stroke-dasharray="1.2 0.8"')
    s.text(X(W / 2), Y(H / 2) + 1, 'placa 50 × 70', 2.4, color='#8d6e63')
    for L, _, nome in ref['apoios']:
        cor = '#6a1b9a' if nome == 'LSM6DS3' else '#1565c0'
        s.rect(X(L['x0']), Y(L['y0']), L['l'], L['w'], 'none', cor, 0.3, ' stroke-dasharray="1.2 0.8"')
        s.text(X(L['x0'] + L['l'] / 2), Y(L['y0'] + L['w'] / 2) + 0.7, nome, 2.0, color=cor)
    # aberturas na parede direita (marcadas por cima)
    for k, rot in (('usb', 'USB'), ('obd', 'OBD')):
        a = med['aberturas'][k]
        s.rect(X(I['x1']), Y(a['centro_y'] - a['largura'] / 2), PAREDE, a['largura'], '#ffffff', '#c62828', 0.25)
        s.text(X(o['x1']) + 2, Y(a['centro_y']) + 0.9, rot, 2.2, anchor='start', color='#c62828')
    # cotas
    s.cota_h(X(o['x0']), X(o['x1']), Y(o['y0']) - 13, f'{_f(med["externa"][0])} (sem abas)', Y(o['y0']))
    s.cota_h(X(I['x0']), X(I['x1']), Y(o['y0']) - 7.5, f'{_f(med["interna"][0])} por dentro', Y(I['y0']))
    t0, t1 = torres()[0], torres()[1]
    s.cota_h(X(t0[0]), X(t1[0]), Y(o['y1']) + 17, f'{_f(t1[0] - t0[0])} entre parafusos', Y(t0[1]) + 0)
    ab = [p for p in cx['base'] if p['t'] == 'furada']
    s.cota_h(X(ab[0]['c'][0]), X(ab[1]['c'][0]), Y(o['y1']) + 23, f'{_f(ab[1]["c"][0] - ab[0]["c"][0])} entre furos das abas', Y(ab[0]['c'][1]))
    fd = 2 * ABA['fenda_dist'] + (o['x1'] - o['x0'])
    s.cota_h(X(o['x0'] - ABA['fenda_dist']), X(o['x1'] + ABA['fenda_dist']), Y(o['y1']) + 29, f'{_f(fd)} entre fendas das abas', Y(ab[0]['c'][1]))
    s.cota_h(X(o['x0'] - ABA['sai']), X(o['x1'] + ABA['sai']), Y(o['y1']) + 35, f'{_f(o["x1"] - o["x0"] + 2 * ABA["sai"])} com as abas', Y(ab[0]['c'][1]) + ABA['largura'] / 2)
    s.cota_v(Y(o['y0']), Y(o['y1']), X(o['x0']) - 27, f'{_f(med["externa"][1])}', X(o['x0']))
    s.cota_v(Y(I['y0']), Y(I['y1']), X(o['x0']) - 21, f'{_f(med["interna"][1])} por dentro', X(I['x0']))
    t2 = torres()[2]
    s.cota_v(Y(t0[1]), Y(t2[1]), X(o['x1']) + 24, f'{_f(t2[1] - t0[1])} entre parafusos', X(t0[0]))

    # ---- Vista da parede direita, por fora (y na horizontal, z para cima)
    bx0, by0 = 160.0, 40.0
    Yh = lambda y: bx0 + (o['y1'] - y)          # noqa: E731   (vista de fora: o lado do ESP32 fica à direita)
    Zv = lambda z: by0 + (TOPO_Z - z)            # noqa: E731
    s.text(Yh((o['y0'] + o['y1']) / 2), by0 - 12, 'Parede direita, vista de fora (sem a tampa)', 3.4, weight='bold')
    s.rect(Yh(o['y1']), Zv(TOPO_Z), o['y1'] - o['y0'], TOPO_Z - o['z0'], PAR)
    for t in (torres()[1], torres()[3]):
        s.rect(Yh(t[1] + TORRE_R), Zv(TOPO_Z), 2 * TORRE_R, TOPO_Z - o['z0'], '#b0bec5')
    for k, rot in (('usb', 'USB'), ('obd', 'cabo OBD')):
        a = med['aberturas'][k]
        y0_ = a['centro_y'] - a['largura'] / 2
        y1_ = y0_ + a['largura']
        s.rect(Yh(y1_), Zv(TOPO_Z), a['largura'], TOPO_Z - a['z_baixo'], '#ffffff', '#c62828', 0.25)
        s.text(Yh(a['centro_y']), Zv(a['z_baixo']) + 3.2, rot, 2.2, color='#ffffff', weight='bold')
        s.cota_h(Yh(y1_), Yh(y0_), Zv(TOPO_Z) - 3, _f(a['largura']), Zv(TOPO_Z))
        s.cota_v(Zv(TOPO_Z), Zv(a['z_baixo']), Yh(y1_) - 1.5, _f(TOPO_Z - a['z_baixo']))
    s.cota_v(Zv(TOPO_Z), Zv(o['z0']), Yh(o['y0']) + 10, f'{_f(TOPO_Z - o["z0"])} (base)', Yh(o['y0']))
    s.cota_v(Zv(TOPO_Z + TAMPA), Zv(o['z0']), Yh(o['y0']) + 17, f'{_f(o["z1"] - o["z0"])} com a tampa', Yh(o['y0']))
    s.text(Yh(o['y0']), Zv(TOPO_Z + TAMPA) - 2, 'lado do ESP32 →', 2.2, anchor='end', color='#546e7a')
    s.rect(Yh(o['y1']), Zv(TOPO_Z + TAMPA), o['y1'] - o['y0'], TAMPA, 'none', '#607d8b', 0.25, ' stroke-dasharray="1 0.7"')
    for k in ('usb', 'obd'):
        a = med['aberturas'][k]
        s.cota_h(Yh(a['centro_y']), Yh(o['y0']), Zv(o['z0']) + {'usb': 6, 'obd': 12}[k],
                 f'centro a {_f(a["centro_y"] - o["y0"])}', Zv(o['z0']))

    # ---- Corte de lado: alturas internas
    cx0, cy0 = 160.0, 140.0
    s.text(Yh((o['y0'] + o['y1']) / 2), cy0 - 4, 'Alturas', 3.4, weight='bold')
    linhas = [
        f'Fundo {_f(FUNDO)} mm · paredes {_f(PAREDE)} mm · tampa {_f(TAMPA)} mm',
        f'Por dentro: {_f(med["interna"][0])} × {_f(med["interna"][1])} × {_f(med["interna"][2])} mm',
        f'Por fora: {_f(med["externa"][0])} × {_f(med["externa"][1])} × {_f(med["externa"][2])} mm (sem abas e torres)',
        f'Placa a {_f(-PISO_Z)} mm do fundo, nos 4 apoios dos cantos; batentes na tampa a 0,3 mm dela',
        'Tampa: 4 parafusos M3 × 12 (furo-guia de 2,6 mm nas torres; 3,4 mm na tampa)',
        'Furos na tampa: 3 mm em cima do LED azul do ESP32 e 5 mm para o LED tricolor',
        'Abas: furo de 4,5 mm (parafuso M4) e fenda de 5,4 × 2,2 mm (abraçadeira de até 5 mm)',
        'LSM6DS3 e BMP180 dentro, cada um no seu apoio, com fita dupla-face',
        'Imprimir em PETG ou ASA (PLA amolece no carro ao sol), sem suporte',
    ]
    for i, t in enumerate(linhas):
        s.text(cx0, cy0 + 4 + i * 4.6, t, 2.8, anchor='start')
    del cx0
    w_total, h_total = 290, 200
    head = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w_total * 3}" height="{h_total * 3}" viewBox="0 0 {w_total} {h_total}">'
            '<defs><marker id="s" viewBox="0 0 4 4" refX="2" refY="2" markerWidth="4" markerHeight="4" orient="auto-start-reverse">'
            '<path d="M0,0 L4,2 L0,4 z" fill="#c62828"/></marker></defs>'
            f'<rect width="{w_total}" height="{h_total}" fill="#ffffff"/>')
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(head + ''.join(s.el) + '<text x="4" y="196" font-size="2.4" fill="#78909c" font-family="Arial, Helvetica, sans-serif">'
                 'Medidas em mm. Gerado por caixa.py. Alturas dos componentes estimadas: confira a placa montada antes de imprimir.</text></svg>\n')


def escrever(out_dir, cx, ref):
    base = [t for p in cx['base'] for t in malha(p)]
    tampa = [t for p in cx['tampa'] for t in malha(p)]
    write_stl(os.path.join(out_dir, 'caixa-base.stl'), para_mesa(base), 'Caixa da placa da escuta CAN - base')
    write_stl(os.path.join(out_dir, 'caixa-tampa.stl'), para_mesa(tampa, virar=True), 'Caixa da placa da escuta CAN - tampa')
    write_scad(os.path.join(out_dir, 'caixa.scad'), cx)
    write_svg(os.path.join(out_dir, 'caixa.svg'), cx, ref)
    return len(base), len(tampa)
