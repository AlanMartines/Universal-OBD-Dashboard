#!/usr/bin/env python3
"""Gera a placa ilhada 5 x 7 cm da escuta CAN do Uno Vivace: ESP32 DevKit V1 + TJA1050 + RT8272.

Saída: cima.svg e baixo.svg em tamanho real (1:1), e as versões ampliadas cima-2x.svg e baixo-2x.svg,
na mesma pasta deste script. Só biblioteca padrão do Python 3:

    python3 veiculos/fiat-uno-vivace-2012/placa/gerar_placa.py

PROVISÓRIO: posições baseadas em medidas de catálogo. Confira com as medidas reais (README.md).
"""
import os
OUT = os.path.dirname(os.path.abspath(__file__))
P=2.54; W,H=50.0,70.0; COLS,ROWS=18,24
MX=(W-(COLS-1)*P)/2; MY=(H-(ROWS-1)*P)/2
def hp(c,r): return (MX+(c-1)*P, MY+(r-1)*P)
RED,BLK,YEL,BLU,GRN,ORG='#c62828','#212121','#b58900','#1565c0','#2e7d32','#e65100'
# ESP32 com o USB para cima: coluna 2 (esquerda) e 12 (direita), linhas 3..17
LEFT=['3V3','GND','D15','D2','D4','RX2','TX2','D5','D18','D19','D21','RX0','TX0','D22','D23']
RIGHT=['VIN','GND','D13','D12','D14','D27','D26','D25','D33','D32','D35','D34','VN','VP','EN']
used_left={'3V3':RED,'GND':BLK,'D21':YEL}; used_right={'VIN':RED,'GND':BLK}
# Pontes de solda (lado de baixo): listas de furos ligados
bridges=[
 ([(15,1),(15,2),(15,3)],RED,'12 V do pino 16 → fusível'),
 ([(12,3),(13,3),(13,2)],RED,'5 V (VIN)'),
 ([(12,4),(13,4),(13,5),(14,5)],BLK,'GND'),
 ([(2,3),(3,3),(4,3)],ORG,'3V3 → R4'),
 ([(2,4),(3,4)],BLK,'GND (lado esquerdo)'),
 ([(2,13),(3,13),(4,13),(5,13)],YEL,'D21: R1 e R2'),
 ([(9,13),(10,13)],YEL,'R2 → R3'),
]
resistors=[('R1',(4,9),(4,13),'1 kΩ · RX do TJA → D21'),('R2',(5,13),(9,13),'1 kΩ · D21 → R3'),('R3',(10,13),(10,9),'1 kΩ · R2 → GND'),('R4',(4,3),(8,3),'1 kΩ · 3V3 → CANH')]
obd=[(15,1,'16','+12 V'),(16,1,'4','chassi'),(17,1,'5','sinal'),(18,1,'14','CAN-L')]
# Módulos presos com fita: posição aproximada (mm) e onde ficam os pinos
tja={'x':hp(14,14)[0]-1.3,'y':hp(14,14)[1],'w':12.0,'h':22.0}
buck={'x':hp(2,21)[0]-1.0,'y':hp(2,21)[1]-1.0,'w':24.0,'h':12.0}
def tja_pin(i): return (tja['x']+tja['w']-1.8, tja['y']+3+i*3.2)
TJA_PINS=['VCC','GND','TX','RX','CANH','CANL']
def buck_pin(name):
  m={'IN+':(buck['x']+buck['w']-2,buck['y']+2.2),'IN-':(buck['x']+buck['w']-2,buck['y']+buck['h']-2.2),'OUT+':(buck['x']+2,buck['y']+2.2),'OUT-':(buck['x']+2,buck['y']+buck['h']-2.2)}
  return m[name]
wires=[ # (de furo, até (módulo,pino) ou furo, cor, nome)
 ((15,12),('buck','IN+'),RED,'F1'),((16,1),('buck','IN-'),BLK,'F2'),((13,2),('buck','OUT+'),RED,'F3'),((13,5),('buck','OUT-'),BLK,'F4'),
 ((13,3),('tja','VCC'),RED,'F5'),((13,4),('tja','GND'),BLK,'F6'),((4,9),('tja','RX'),YEL,'F7'),((8,3),('tja','CANH'),BLU,'F8'),
 ((18,1),('tja','CANL'),BLU,'F9'),((17,1),(14,5),BLK,'F10'),((10,9),(3,4),BLK,'F11'),
]
def endpoint(e):
  if isinstance(e[0],int): return hp(*e)
  return buck_pin(e[1]) if e[0]=='buck' else tja_pin(TJA_PINS.index(e[1]))

def svg(view, scale):
  mirror = view=='baixo'
  X=lambda x: (W-x) if mirror else x
  o=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W*scale}mm" height="{H*scale}mm" viewBox="-0.5 -0.5 {W+1} {H+1}" font-family="DejaVu Sans, Arial, sans-serif">']
  o.append(f'<rect x="0" y="0" width="{W}" height="{H}" rx="1.2" fill="#f4ecd8" stroke="#8d6e63" stroke-width="0.3"/>')
  used=set()
  for pts,_,_ in bridges: used|=set(pts)
  for _,a,b,_ in resistors: used|={a,b}
  for c,r,_,_ in obd: used.add((c,r))
  for w in wires:
    for e in w[:2]:
      if isinstance(e[0],int): used.add(e)
  for c in range(1,COLS+1):
    for r in range(1,ROWS+1):
      x,y=hp(c,r); x=X(x)
      o.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="0.85" fill="#d9a441" stroke="#a1742a" stroke-width="0.12"/><circle cx="{x:.2f}" cy="{y:.2f}" r="0.42" fill="#3e2f1c"/>')
  # coordenadas nas bordas
  for c in range(1,COLS+1):
    x,_=hp(c,1); o.append(f'<text x="{X(x):.2f}" y="1.9" font-size="1.15" text-anchor="middle" fill="#6d4c41">{c}</text>')
  for r in range(1,ROWS+1):
    _,y=hp(1,r); xx=1.3 if not mirror else W-1.3
    o.append(f'<text x="{xx:.2f}" y="{y+0.4:.2f}" font-size="1.15" text-anchor="middle" fill="#6d4c41">{r}</text>')
  # área da antena (sem cobre nem fios)
  ax0,ay0=hp(1,18); ax1,ay1=hp(13,20)
  o.append(f'<rect x="{min(X(ax0-1),X(ax1+1)):.2f}" y="{ay0-1:.2f}" width="{ax1-ax0+2:.2f}" height="{ay1-ay0+2:.2f}" fill="none" stroke="#9e9e9e" stroke-width="0.25" stroke-dasharray="0.8 0.6"/>')
  o.append(f'<text x="{X((ax0+ax1)/2):.2f}" y="{(ay0+ay1)/2+0.5:.2f}" font-size="1.5" text-anchor="middle" fill="#757575">antena: deixe livre</text>')
  if view=='cima':
    # ESP32
    cx,_=hp(7,10); _,cy=hp(7,10)
    o.append(f'<rect x="{cx-14.15:.2f}" y="{cy-25.75:.2f}" width="28.3" height="51.5" rx="1" fill="rgba(25,25,112,.07)" stroke="#283593" stroke-width="0.3" stroke-dasharray="1.2 0.6"/>')
    o.append(f'<text x="{cx:.2f}" y="{cy-25.75+2.4:.2f}" font-size="1.7" text-anchor="middle" fill="#283593">USB ↑  ESP32 DevKit V1 (30 pinos)</text>')
    o.append(f'<text x="{cx:.2f}" y="{cy+1:.2f}" font-size="1.4" text-anchor="middle" fill="#283593">em barras de pinos fêmea</text>')
    for i,n in enumerate(LEFT):
      x,y=hp(2,3+i); col=used_left.get(n,'#5c6bc0'); bold='bold' if n in used_left else 'normal'
      o.append(f'<rect x="{x-0.9:.2f}" y="{y-0.9:.2f}" width="1.8" height="1.8" fill="none" stroke="#283593" stroke-width="0.2"/><text x="{x+1.3:.2f}" y="{y+0.45:.2f}" font-size="1.2" fill="{col}" font-weight="{bold}">{n}</text>')
    for i,n in enumerate(RIGHT):
      x,y=hp(12,3+i); col=used_right.get(n,'#5c6bc0'); bold='bold' if n in used_right else 'normal'
      o.append(f'<rect x="{x-0.9:.2f}" y="{y-0.9:.2f}" width="1.8" height="1.8" fill="none" stroke="#283593" stroke-width="0.2"/><text x="{x-1.3:.2f}" y="{y+0.45:.2f}" font-size="1.2" fill="{col}" font-weight="{bold}" text-anchor="end">{n}</text>')
    # fusível
    a,_=hp(15,3); b,_=hp(17,3); _,y0=hp(15,3); _,y1=hp(15,12)
    o.append(f'<rect x="{a-1.2:.2f}" y="{y0-1.6:.2f}" width="{b-a+2.4:.2f}" height="{y1-y0+3.2:.2f}" rx="1" fill="rgba(198,40,40,.06)" stroke="{RED}" stroke-width="0.3"/>')
    for (c,r) in [(15,3),(17,3),(15,12),(17,12)]:
      x,y=hp(c,r); o.append(f'<rect x="{x-0.9:.2f}" y="{y-0.9:.2f}" width="1.8" height="1.8" fill="none" stroke="{RED}" stroke-width="0.25"/>')
    o.append(f'<text x="{(a+b)/2:.2f}" y="{(y0+y1)/2-1:.2f}" font-size="1.4" text-anchor="middle" fill="{RED}" transform="rotate(-90 {(a+b)/2:.2f} {(y0+y1)/2:.2f})">porta-fusível 5×20 · 1 A</text>')
    # resistores
    for n,a,b,desc in resistors:
      (x1,y1),(x2,y2)=hp(*a),hp(*b)
      o.append(f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" stroke="#757575" stroke-width="0.35"/>')
      mx,my=(x1+x2)/2,(y1+y2)/2; horiz=abs(y1-y2)<0.1
      w,h=(5.6,2.0) if horiz else (2.0,5.6)
      o.append(f'<rect x="{mx-w/2:.2f}" y="{my-h/2:.2f}" width="{w}" height="{h}" rx="0.8" fill="#d7ccc8" stroke="#5d4037" stroke-width="0.25"/><text x="{mx:.2f}" y="{my+0.45:.2f}" font-size="1.2" text-anchor="middle" font-weight="bold" fill="#3e2723">{n}</text>')
    # módulos
    o.append(f'<rect x="{tja["x"]:.2f}" y="{tja["y"]:.2f}" width="{tja["w"]}" height="{tja["h"]}" rx="0.8" fill="rgba(21,101,192,.06)" stroke="{BLU}" stroke-width="0.3" stroke-dasharray="1 0.5"/>')
    o.append(f'<text x="{tja["x"]+3.2:.2f}" y="{tja["y"]+tja["h"]/2:.2f}" font-size="1.4" text-anchor="middle" fill="{BLU}" transform="rotate(-90 {tja["x"]+3.2:.2f} {tja["y"]+tja["h"]/2:.2f})">TJA1050 · fita dupla-face</text>')
    for i,n in enumerate(TJA_PINS):
      x,y=tja_pin(i); o.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="0.6" fill="#fff" stroke="{BLU}" stroke-width="0.25"/><text x="{x-1:.2f}" y="{y+0.45:.2f}" font-size="1.15" text-anchor="end" fill="{BLU}">{n}</text>')
    o.append(f'<rect x="{buck["x"]:.2f}" y="{buck["y"]:.2f}" width="{buck["w"]}" height="{buck["h"]}" rx="0.8" fill="rgba(46,125,50,.07)" stroke="{GRN}" stroke-width="0.3" stroke-dasharray="1 0.5"/>')
    o.append(f'<text x="{buck["x"]+buck["w"]/2:.2f}" y="{buck["y"]+buck["h"]/2+0.5:.2f}" font-size="1.4" text-anchor="middle" fill="{GRN}">RT8272 · 5,0 V · fita</text>')
    for n in ['IN+','IN-','OUT+','OUT-']:
      x,y=buck_pin(n); anchor='end' if n.startswith('IN') else 'start'; dx=-1 if anchor=='end' else 1
      o.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="0.6" fill="#fff" stroke="{GRN}" stroke-width="0.25"/><text x="{x+dx:.2f}" y="{y+0.45:.2f}" font-size="1.15" text-anchor="{anchor}" fill="{GRN}">{n}</text>')
    # fios
    for a,b,col,name in wires:
      (x1,y1),(x2,y2)=endpoint(a),endpoint(b)
      mx,my=(x1+x2)/2+ (2 if x2>x1 else -2), (y1+y2)/2
      o.append(f'<path d="M{x1:.2f},{y1:.2f} Q{mx:.2f},{my:.2f} {x2:.2f},{y2:.2f}" fill="none" stroke="{col}" stroke-width="0.45" stroke-linecap="round" opacity=".85"/>')
      lx,ly=(x1+2*mx+x2)/4,(y1+2*my+y2)/4
      o.append(f'<rect x="{lx-1.5:.2f}" y="{ly-1:.2f}" width="3" height="1.8" rx="0.4" fill="#fff" stroke="{col}" stroke-width="0.15"/><text x="{lx:.2f}" y="{ly+0.45:.2f}" font-size="1.1" text-anchor="middle" fill="{col}" font-weight="bold">{name}</text>')
  # pontes (as duas vistas; em cima, finas)
  for pts,col,_ in bridges:
    d=' '.join(f'{"M" if i==0 else "L"}{X(hp(*p)[0]):.2f},{hp(*p)[1]:.2f}' for i,p in enumerate(pts))
    o.append(f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{1.1 if mirror else 0.35}" stroke-linecap="round" stroke-linejoin="round" opacity="{0.9 if mirror else 0.5}"/>')
  if mirror:
    for n,a,b,desc in resistors:
      for p in (a,b):
        x,y=hp(*p); o.append(f'<circle cx="{X(x):.2f}" cy="{y:.2f}" r="0.6" fill="#9e9e9e"/>')
      (x1,y1),(x2,y2)=hp(*a),hp(*b)
      o.append(f'<text x="{X((x1+x2)/2):.2f}" y="{(y1+y2)/2+0.45:.2f}" font-size="1.2" text-anchor="middle" fill="#424242">{n}</text>')
    o.append(f'<text x="{W/2}" y="{H-1.2}" font-size="1.6" text-anchor="middle" fill="#6d4c41">VISTA DE BAIXO (lado da solda, espelhada)</text>')
  else:
    o.append(f'<text x="{W/2}" y="{H-1.2}" font-size="1.6" text-anchor="middle" fill="#6d4c41">VISTA DE CIMA (lado dos componentes)</text>')
  # ilhas do cabo OBD
  for c,r,pin,desc in obd:
    x,y=hp(c,r); col={'16':RED,'4':BLK,'5':BLK,'14':BLU}[pin]
    o.append(f'<circle cx="{X(x):.2f}" cy="{y:.2f}" r="1.05" fill="none" stroke="{col}" stroke-width="0.35"/>')
    o.append(f'<text x="{X(x):.2f}" y="{y-1.5:.2f}" font-size="1.2" text-anchor="middle" fill="{col}" font-weight="bold">{pin}</text>')
  o.append('</svg>')
  return '\n'.join(o)

open(os.path.join(OUT, 'cima.svg'),'w').write(svg('cima',1))
open(os.path.join(OUT, 'baixo.svg'),'w').write(svg('baixo',1))
open(os.path.join(OUT, 'cima-2x.svg'),'w').write(svg('cima',2.6))
open(os.path.join(OUT, 'baixo-2x.svg'),'w').write(svg('baixo',2.6))
print('ok')
