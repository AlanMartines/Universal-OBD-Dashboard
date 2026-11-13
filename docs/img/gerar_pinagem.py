"""Gera os desenhos de pinagem da tomada OBD2 (SVG, sem imagens de terceiros).

- docs/img/pinagem-obd2.svg: pinagem da norma SAE J1962 e os pinos de cada protocolo;
- veiculos/fiat-uno-vivace-2012/img/pinagem-obd2-uno.svg: o que tem em cada pino do Uno Vivace 2012 e a posição da
  tomada no carro (invertida: parte larga embaixo, pino 1 embaixo à direita, contando da direita para a esquerda).

Copia os dois para server/web/src/modules/projeto/public/, de onde o painel os serve. Uso, na raiz do projeto ou
de qualquer lugar: python3 docs/img/gerar_pinagem.py
"""
import shutil
from pathlib import Path
from xml.sax.saxutils import escape as esc

COR = {'pwr': '#b91c1c', 'gnd': '#475569', 'k': '#7c3aed', 'canh': '#1d4ed8', 'canl': '#0e7490', 'j1850': '#a16207', 'livre': '#cbd5e1'}
STYLE = """text{font-family:Arial,Helvetica,'DejaVu Sans',sans-serif;fill:#1f2937;font-size:15px}
.t{font-size:22px;font-weight:700}.s{font-size:14px;fill:#4b5563}.m{text-anchor:middle}.e{text-anchor:end}
.n{font-size:17px;font-weight:700;text-anchor:middle;fill:#111827}.nl{font-size:17px;font-weight:700;text-anchor:middle;fill:#ffffff}
.lb{font-size:15px;font-weight:700}.h{font-size:16px;font-weight:700;text-anchor:middle}
.mini{font-size:10px;font-weight:700;text-anchor:middle;fill:#111827}.minil{font-size:10px;font-weight:700;text-anchor:middle;fill:#fff}
.b{fill:#f8fafc;stroke:#334155;stroke-width:2}"""

def conector(cx, cy, esc_=1.0, pinos=None, mini=False, invertida=False):
    """Tomada na posição padrão: 1–8 em cima, 9–16 embaixo. invertida: de cabeça para baixo (pino 1 embaixo, à
    direita), como fica em alguns carros. pinos: {n: cor} (sem cor = livre)."""
    s = esc_
    wt, wb, h = 560 * s, 480 * s, 170 * s
    if invertida:
        wt, wb = wb, wt
    out = []
    p = [(cx - wt / 2, cy - h / 2), (cx + wt / 2, cy - h / 2), (cx + wb / 2, cy + h / 2), (cx - wb / 2, cy + h / 2)]
    out.append(f'<path d="M{p[0][0]:.1f},{p[0][1]:.1f} L{p[1][0]:.1f},{p[1][1]:.1f} L{p[2][0]:.1f},{p[2][1]:.1f} L{p[3][0]:.1f},{p[3][1]:.1f} Z" fill="#111827" stroke="#111827" stroke-width="{max(2, 14 * s):.1f}" stroke-linejoin="round"/>')
    out.append(f'<rect x="{cx - 230 * s:.1f}" y="{cy - 12 * s:.1f}" width="{460 * s:.1f}" height="{24 * s:.1f}" fill="#f8fafc"/>')
    pos = {}
    for k in range(16):
        row = k // 8
        sg = -1 if invertida else 1
        x = cx + sg * (-210 + (k % 8) * 60) * s
        y = cy + sg * (-45 if row == 0 else 45) * s
        pos[k + 1] = (x, y)
        cor = (pinos or {}).get(k + 1)
        w, hh = 40 * s, 48 * s
        out.append(f'<rect x="{x - w / 2:.1f}" y="{y - hh / 2:.1f}" width="{w:.1f}" height="{hh:.1f}" rx="{3 * s:.1f}" fill="{cor or "#f8fafc"}" stroke="{cor or "#94a3b8"}" stroke-width="{max(1, 2 * s):.1f}"/>')
        cls = ('minil' if cor else 'mini') if mini else ('nl' if cor else 'n')
        out.append(f'<text x="{x:.1f}" y="{y + (4 if mini else 6):.1f}" class="{cls}">{k + 1}</text>')
    return out, pos

def rotulos(pos, labels, cy):
    """labels: {pino: (texto, cor)}. Linha para cima (1–8) ou para baixo (9–16) e texto inclinado."""
    out = []
    for n, (txt, cor) in labels.items():
        x, y = pos[n]
        if n <= 8:
            y0, y1 = y - 24, cy - 150
            out.append(f'<line x1="{x:.1f}" y1="{y0:.1f}" x2="{x:.1f}" y2="{y1:.1f}" stroke="{cor}" stroke-width="3.5"/>')
            out.append(f'<path d="M{x - 7:.1f},{y1 + 10:.1f} L{x:.1f},{y1 - 2:.1f} L{x + 7:.1f},{y1 + 10:.1f} Z" fill="{cor}"/>')
            out.append(f'<text x="{x + 4:.1f}" y="{y1 - 10:.1f}" class="lb" fill="{cor}" style="fill:{cor}" transform="rotate(-45 {x + 4:.1f} {y1 - 10:.1f})">{esc(txt)}</text>')
        else:
            y0, y1 = y + 24, cy + 150
            out.append(f'<line x1="{x:.1f}" y1="{y0:.1f}" x2="{x:.1f}" y2="{y1:.1f}" stroke="{cor}" stroke-width="3.5"/>')
            out.append(f'<path d="M{x - 7:.1f},{y1 - 10:.1f} L{x:.1f},{y1 + 2:.1f} L{x + 7:.1f},{y1 - 10:.1f} Z" fill="{cor}"/>')
            out.append(f'<text x="{x - 4:.1f}" y="{y1 + 14:.1f}" class="lb e" style="fill:{cor}" transform="rotate(-45 {x - 4:.1f} {y1 + 14:.1f})">{esc(txt)}</text>')
    return out

def svg(w, h, titulo, desc, corpo):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{esc(desc)}">'
            f'<title>{esc(titulo)}</title><style>\n{STYLE}\n</style><rect width="{w}" height="{h}" fill="#ffffff"/>' + ''.join(corpo) + '</svg>\n')

RAIZ = Path(__file__).resolve().parents[2]
GERAL = RAIZ / 'docs/img/pinagem-obd2.svg'
UNO = RAIZ / 'veiculos/fiat-uno-vivace-2012/img/pinagem-obd2-uno.svg'
PAINEL = RAIZ / 'server/web/src/modules/projeto/public'

# ------------------------------------------------------------------ pinagem geral (SAE J1962)
W, H = 1000, 1030
cx, cy = 500, 410
L = {2: ('J1850 (BUS+)', COR['j1850']), 4: ('Terra do chassi', COR['gnd']), 5: ('Terra de sinal', COR['gnd']),
     6: ('CAN-H (ISO 15765)', COR['canh']), 7: ('Linha K (ISO 9141 / 14230)', COR['k']),
     10: ('J1850 (BUS−)', COR['j1850']), 14: ('CAN-L (ISO 15765)', COR['canl']), 15: ('Linha L (opcional)', COR['k']), 16: ('+12 V da bateria', COR['pwr'])}
c, pos = conector(cx, cy, 1.0, {n: v[1] for n, v in L.items()})
corpo = [f'<text x="40" y="44" class="t">Tomada OBD2 (SAE J1962), </text>',
         f'<text x="40" y="70" class="s">Só os pinos que a norma fixa. Os pinos 1, 3, 8, 9, 11, 12 e 13 ficam livres para cada fabricante usar como quiser.</text>']
corpo += c + rotulos(pos, L, cy)
# protocolos
protos = [('ISO 9141 / 14230', 'linha K (inclui KWP)', {4: COR['gnd'], 5: COR['gnd'], 7: COR['k'], 15: COR['livre'], 16: COR['pwr']}, '4, 5, 7 e 16 (15 opcional)'),
          ('SAE J1850 VPW', 'GM, Chrysler', {2: COR['j1850'], 4: COR['gnd'], 5: COR['gnd'], 16: COR['pwr']}, '2, 4, 5 e 16'),
          ('SAE J1850 PWM', 'Ford', {2: COR['j1850'], 4: COR['gnd'], 5: COR['gnd'], 10: COR['j1850'], 16: COR['pwr']}, '2, 4, 5, 10 e 16'),
          ('ISO 15765 (CAN)', 'obrigatório desde 2008 nos EUA', {4: COR['gnd'], 5: COR['gnd'], 6: COR['canh'], 14: COR['canl'], 16: COR['pwr']}, '4, 5, 6, 14 e 16')]
y0 = 770
corpo.append(f'<text x="40" y="{y0 - 26}" class="lb">Quais pinos cada protocolo de diagnóstico usa</text>')
for i, (nome, sub, pins, lista) in enumerate(protos):
    bx = 40 + i * 235
    corpo.append(f'<rect x="{bx}" y="{y0}" width="220" height="230" rx="10" class="b"/>')
    corpo.append(f'<text x="{bx + 110}" y="{y0 + 28}" class="h">{esc(nome)}</text>')
    corpo.append(f'<text x="{bx + 110}" y="{y0 + 48}" class="s m">{esc(sub)}</text>')
    cc, _ = conector(bx + 110, y0 + 115, 0.34, pins, mini=True)
    corpo += cc
    corpo.append(f'<text x="{bx + 110}" y="{y0 + 185}" class="s m">Pinos:</text>')
    corpo.append(f'<text x="{bx + 110}" y="{y0 + 207}" class="m" style="font-weight:700">{esc(lista)}</text>')
desc = ('Tomada OBD2: pinos 1 a 8 numa fileira e 9 a 16 na outra. Pino 2 J1850 BUS+, 4 terra do chassi, 5 terra de sinal, '
        '6 CAN-H, 7 linha K, 10 J1850 BUS−, 14 CAN-L, 15 linha L opcional, 16 +12 V. Os demais ficam a critério do fabricante. '
        'ISO 9141/14230 usa 4, 5, 7 e 16; J1850 VPW 2, 4, 5 e 16; J1850 PWM 2, 4, 5, 10 e 16; CAN 4, 5, 6, 14 e 16.')
open(GERAL, 'w').write(svg(W, H, 'Pinagem da tomada OBD2', desc, corpo))

# ------------------------------------------------------------------ Uno Vivace
W, H = 1000, 1320
L = {4: ('Terra do chassi', COR['gnd']), 5: ('Terra de sinal', COR['gnd']),
     6: ('CAN-H da carroceria (≈ 0 V)', COR['canh']), 7: ('Linha K → injeção IAW 7GF', COR['k']),
     14: ('CAN-L da carroceria, 50 kbps', COR['canl']), 16: ('+12 V da bateria', COR['pwr'])}
c, pos = conector(cx, cy, 1.0, {n: v[1] for n, v in L.items()})
corpo = [f'<text x="40" y="44" class="t">Fiat Uno Vivace 2012: o que tem em cada pino</text>',
         f'<text x="40" y="70" class="s">Pinos 6 e 14 medidos no carro e 7 pelo manual Mecânica 2000; os demais não são usados pelo projeto.</text>']
corpo += c + rotulos(pos, L, cy)
# a mesma tomada nas duas posições: a da norma e a do Uno, que fica de cabeça para baixo
y0 = 770
corpo.append(f'<text x="40" y="{y0 - 18}" class="lb">Posição da tomada</text>')
for i, (tit, sub, inv) in enumerate([('Padrão da norma (como no desenho acima)', 'Parte larga em cima: pino 1 em cima, à esquerda, contando da esquerda para a direita.', False),
                                      ('No Uno: invertida (de cabeça para baixo)', 'Parte larga embaixo: pino 1 embaixo, à direita, contando da direita para a esquerda.', True)]):
    bx = 40 + i * 470
    corpo.append(f'<rect x="{bx}" y="{y0}" width="450" height="240" rx="10" class="b"/>')
    corpo.append(f'<text x="{bx + 225}" y="{y0 + 30}" class="h">{esc(tit)}</text>')
    cc, _ = conector(bx + 225, y0 + 125, 0.62, {n: v[1] for n, v in L.items()}, mini=True, invertida=inv)
    corpo += cc
    for j, ln in enumerate(sub.split(': ')):
        corpo.append(f'<text x="{bx + 225}" y="{y0 + 208 + j * 20}" class="s m">{esc(ln + (":" if j == 0 else ""))}</text>')
y0 = 1045
cards = [('ELM327 (consultas OBD)', ['Numa das fêmeas do cabo Y.', 'Fala com a injeção pela linha K, pino 7:', 'ISO 14230-4 KWP rápido (ATSP5).', 'Usa também 4, 5 e 16.']),
         ('Placa do ESP32 (só escuta)', ['Pino 16: +12 V, pelo fusível de 1,5 A.', 'Pinos 4 e 5: terra.', 'Pino 14: CAN-L, recebido em listen-only.', 'Pino 6 fica isolado (só o 14 basta).'])]
for i, (tit, linhas) in enumerate(cards):
    bx = 40 + i * 470
    corpo.append(f'<rect x="{bx}" y="{y0}" width="450" height="200" rx="10" class="b"/>')
    corpo.append(f'<text x="{bx + 20}" y="{y0 + 34}" class="lb">{esc(tit)}</text>')
    for j, ln in enumerate(linhas):
        corpo.append(f'<text x="{bx + 20}" y="{y0 + 72 + j * 30}">{esc(ln)}</text>')
corpo.append(f'<text x="40" y="{H - 24}" class="s">Nada é enviado à rede CAN: o ESP32 só escuta, e o ELM327 só faz consultas de diagnóstico.</text>')
desc = ('Tomada OBD2 do Fiat Uno Vivace 2012. No carro ela fica invertida: pino 1 embaixo, à direita, contando da direita para a esquerda (parte larga embaixo). Pino 4 terra do chassi, 5 terra de sinal, 6 CAN-H da carroceria, '
        '7 linha K da injeção IAW 7GF, 14 CAN-L da carroceria a 50 kbps, 16 +12 V. O ELM327 usa a linha K (KWP rápido); '
        'a placa do ESP32 usa 16 pelo fusível, 4 e 5 de terra e 14 em listen-only, com o 6 isolado.')
open(UNO, 'w').write(svg(W, H, 'Pinagem OBD2 do Fiat Uno Vivace 2012', desc, corpo))
for f in (GERAL, UNO):
    shutil.copy(f, PAINEL / f.name)
    print(f'ok: {f.relative_to(RAIZ)} (e a cópia do painel)')
