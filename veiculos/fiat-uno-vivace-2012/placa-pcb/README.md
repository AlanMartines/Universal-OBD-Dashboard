# PCB da escuta CAN (KiCad 9)

PCB de duas faces para fábrica (JLCPCB, PCBWay), com o **mesmo circuito** da placa ilhada 5 × 7 cm na versão
**TJA1050** (`../placa/`). Tudo sai do `gerar_kicad.py`, sem interface gráfica:

```bash
python3 veiculos/fiat-uno-vivace-2012/placa-pcb/gerar_kicad.py
```

O script lê as posições e as ligações do `../placa/gerar_placa.py`, as alturas dos módulos do `../placa/gerar_3d.py`
e o tamanho da placa e dos apoios do `../placa/caixa.py`. Mudou a placa ilhada, rode de novo.

## O que ele gera

| Arquivo | Conteúdo |
|---|---|
| `escuta_can.kicad_sym`, `escuta_can.pretty/`, `escuta_can.3dshapes/` | Biblioteca do projeto: ESP32 DevKit V1 (50 × 28 mm, barras a 25,4 mm), TJA1050 (22 × 11 mm), RT8272 HW-108 (21 × 21 mm), porta-fusível AS-06 (pinos a 20,32 mm, furo de 1,5 mm), ilhas do cabo OBD, barras, resistores, C1 e pontos de teste Keystone 5000. Modelos 3D dos módulos em VRML e STEP, com as medidas reais |
| `escuta-can-uno.kicad_pro`, `.kicad_sch`, `.kicad_pcb`, `.kicad_dru` | Projeto KiCad. Regras: sinal ≥ 0,25 mm, alimentação (12 V, 12 V com fusível, 5 V, 3V3, GND) ≥ 0,6 mm, folga ≥ 0,2 mm |
| `fabricacao/gerbers-escuta-can-uno.zip` | 9 Gerber, furação Excellon (PTH e NPTH) com mapa e o job: é o que vai para a fábrica |
| `fabricacao/BOM.csv`, `fabricacao/CPL.csv` | Lista de peças e posições no formato da JLCPCB (centro de cada peça, origem no canto de baixo à esquerda) |
| `fabricacao/esquematico.pdf`, `pcb-top.svg`, `pcb-bottom.svg` | Revisão 2D (a face de baixo vem espelhada, como se vê virando a placa) |
| `fabricacao/escuta-can-uno.step`, `render-3d-top.png`, `render-3d-bottom.png` | Modelo 3D (STEP AP214) e as duas vistas, com as peças |
| `fabricacao/render-3d-top-sem-componentes.png`, `render-3d-bottom-sem-componentes.png` | As duas vistas da PCB sem componentes (só a placa) |

O script roda o ERC e o DRC (com a conferência entre esquemático e placa) e para se sobrar qualquer violação ou
ligação faltando. Só depois exporta.

## Como a placa está feita

- **Placa:** 50 × 70 mm, 2 camadas, 1,6 mm. Os 4 cantos (3,5 × 3,5 mm, onde a caixa apoia a placa) ficam sem cobre.
- **Face de cima:** a alimentação (12 V do OBD com 1,0 mm; 12 V com fusível e 5 V com 0,8 mm; ramais e 3V3 com 0,6 mm),
  o RX do TJA1050, o divisor do RX e o LED.
- **Face de baixo:** plano de GND na placa toda e os sinais que cruzam a alimentação (SDA, SCL, D34 e CANH), com 0,3 mm.
- **Plano de GND:** também na face de cima, nos espaços livres, costurado com 120 vias de 0,6/0,3 mm.
- **Só escuta:** o TXD do TJA1050 fica preso em 5 V, então o transceptor nunca transmite. O CANH fica em 3,3 V pelo R4
  e o CANL vai ao pino 14 do OBD (o pino 6 fica sem ligação).

Diferenças de posição em relação à placa ilhada (o circuito é o mesmo):

- **C1:** desce para a linha 20, para não encostar no R6.
- **R5:** sobe uma linha (17 a 21), para não encostar no porta-fusível.
- **TP3:** vai para o furo (10, 16), porque a trilha do 5 V passa na linha 13.

Os módulos, o porta-fusível, as barras dos sensores, o LED e o cabo OBD ficam nos mesmos furos: a placa cabe na
mesma caixa.

## Antes de mandar fabricar

1. **Medidas reais:** confira os módulos nas barras, encaixando o ESP32, o TJA1050 e o RT8272 sobre o desenho em
   tamanho real (`pcb-top.svg` impresso em 100 %).
2. **Peças da montagem:** a CPL e a BOM servem para a montagem pela fábrica, mas todas as peças são de furo
   (montagem à mão). Na JLCPCB, peça só a placa.
3. **Fios do cabo OBD:** confira as cores com o multímetro antes de soldar (a tabela está em `../placa/README.md`).
