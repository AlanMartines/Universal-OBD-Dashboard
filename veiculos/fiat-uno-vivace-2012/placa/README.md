# Placa ilhada da escuta CAN (Uno Vivace)

Placa perfurada de ilhas soltas, 5 × 7 cm (grade de 2,54 mm), com o ESP32 DevKit V1, o transceptor TJA1050 e o conversor RT8272. A ligação elétrica é a de [ligacao-can.md](../ligacao-can.md): só o pino 14 (CAN-L) vai ao transceptor e o CANH fica em 3,3 V por 1 kΩ. O TX do TJA1050 fica preso nos 5 V, então o transceptor nunca transmite.

> **Situação: provisória.** As posições usam medidas de catálogo, que variam entre fabricantes. Antes de soldar, confira com as medidas da tabela abaixo e gere de novo.

## Desenho

| Vista de cima (componentes) | Vista de baixo (solda, espelhada) |
|---|---|
| ![Vista de cima da placa: ESP32, porta-fusível, resistores, módulos e fios F1 a F11](cima-2x.svg) | ![Vista de baixo da placa: pontes de solda coloridas](baixo-2x.svg) |

Cores: vermelho 12 V e 5 V, preto GND, laranja 3V3, amarelo RX/D21, azul CAN. Furos indicados como (coluna, linha), na numeração das bordas do desenho.

## Arquivos

| Arquivo | O que é |
|---|---|
| [`cima.svg`](cima.svg) e [`baixo.svg`](baixo.svg) | Vistas em tamanho real (1:1). A de baixo é espelhada, como se vê ao virar a placa para soldar. Imprima em 100%, sem "ajustar à página". |
| [`cima-2x.svg`](cima-2x.svg) e [`baixo-2x.svg`](baixo-2x.svg) | As mesmas vistas ampliadas, para ler os nomes. |
| [`gerar_placa.py`](gerar_placa.py) | Gera os quatro SVG: `python3 veiculos/fiat-uno-vivace-2012/placa/gerar_placa.py`. |

## Montagem prevista

- **ESP32:** em barras de pinos fêmea, colunas 2 e 12 (10 furos entre fileiras), linhas 3 a 17, com o USB para a borda de cima. A área embaixo da antena (linhas 18 a 20) fica sem fios nem componentes.
- **Resistores de 1 kΩ, embaixo do ESP32:**
  - R4 liga o 3V3 ao CANH;
  - R1 vai do RX do TJA1050 ao D21;
  - R2 e R3, em série, vão do D21 ao GND. É o divisor que leva os 5 V do RX a 3,3 V.
- **Porta-fusível 5 × 20 mm de 1 A** na faixa da direita, entre o pino 16 e o IN+ do RT8272.
- **TJA1050 e RT8272:** presos com fita dupla-face e ligados por fios curtos (F1 a F11 no desenho). Assim o desenho serve para qualquer formato de módulo.
- **Cabo OBD:** fios soldados nas ilhas da borda de cima: 16 (+12 V), 4 (chassi), 5 (terra de sinal) e 14 (CAN-L).

Antes de ligar o ESP32, regule o RT8272 em **5,0 V** com o fio F3 (OUT+ → VIN) ainda solto.

## Pontes, resistores e fios

**Pontes de solda (lado de baixo)**

| Ligação | Furos |
|---|---|
| Pino 16 (+12 V) → porta-fusível | (15,1) – (15,2) – (15,3) |
| 5 V: VIN do ESP32 | (12,3) – (13,3) – (13,2) |
| GND do ESP32 (direita) | (12,4) – (13,4) – (13,5) – (14,5) |
| 3V3 do ESP32 → R4 | (2,3) – (3,3) – (4,3) |
| GND do ESP32 (esquerda) | (2,4) – (3,4) |
| D21 → R1 e R2 | (2,13) – (3,13) – (4,13) – (5,13) |
| R2 → R3 | (9,13) – (10,13) |

**Resistores (1 kΩ, 1/4 W)**

| | Furos | Função |
|---|---|---|
| R1 | (4,9) – (4,13) | RX do TJA1050 → D21 |
| R2 | (5,13) – (9,13) | D21 → R3 (divisor) |
| R3 | (10,13) – (10,9) | R2 → GND (divisor) |
| R4 | (4,3) – (8,3) | 3V3 → CANH |

**Fios (isolados, curtos)**

| | De | Para |
|---|---|---|
| F1 | Porta-fusível, clipe de baixo (15,12) | RT8272 IN+ |
| F2 | Ilha do pino 4 (16,1) | RT8272 IN− |
| F3 | 5 V (13,2) | RT8272 OUT+, **só depois de regular 5,0 V** |
| F4 | GND (13,5) | RT8272 OUT− |
| F5 | 5 V (13,3) | TJA1050 VCC; no módulo, ligue também o TX ao VCC |
| F6 | GND (13,4) | TJA1050 GND |
| F7 | R1 (4,9) | TJA1050 RX |
| F8 | R4 (8,3) | TJA1050 CANH |
| F9 | Ilha do pino 14 (18,1) | TJA1050 CANL |
| F10 | Ilha do pino 5 (17,1) | GND (14,5) |
| F11 | R3 (10,9) | GND esquerdo (3,4) |

**Antes de ligar no carro:** sem nada ligado, não pode haver continuidade entre (15,1) e GND, nem entre (13,2) e GND. Com o ESP32 fora das barras e o F3 solto, regule o OUT+ do RT8272 em 5,0 V. Depois de soldar o F3 e encaixar o ESP32, o D21 deve ficar em até 3,4 V.

## Medidas dos componentes

Preencha com o paquímetro e anote a data. Distâncias de centro a centro dos pinos.

| Componente | Medida | Valor | Data |
|---|---|---|---|
| Placa perfurada | Tamanho (mm) e número de furos (colunas × linhas) | | |
| ESP32 DevKit V1 (30 pinos) | Comprimento × largura da placa (mm) | | |
| | Distância entre as duas fileiras de pinos (mm) | | |
| | Ordem dos pinos, com o USB para baixo (confirmar 3V3, GND, VIN e D21) | | |
| TJA1050 (Teknimas) | Comprimento × largura (mm) | | |
| | Posição e ordem dos pinos | | |
| | Resistência entre CANH e CANL (Ω). Se der cerca de 120 Ω, o resistor de terminação sai | | |
| RT8272 | Comprimento × largura (mm) | | |
| | Posição das ilhas IN+, IN−, OUT+, OUT− | | |
| Porta-fusível 5 × 20 | Distância entre os pinos dos dois clipes (mm) | | |
| SN65HVD230 (reserva, a caminho) | Comprimento × largura e ordem dos pinos | | |
| Conector OBD2 macho (a caminho) | Pinos montados (precisa de 4, 5, 14 e 16) | | |
| Cabo Y OBD2 (a caminho) | Pinos ligados em cada ramo | | |

Medidas de catálogo usadas por enquanto: ESP32 DevKit V1 com cerca de 28,3 × 51,5 mm e fileiras a cerca de 25,4 mm; TJA1050 com cerca de 22 × 11,5 mm.
