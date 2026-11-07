# Placa ilhada da escuta CAN (Uno Vivace)

Placa perfurada de ilhas soltas no tamanho padrão de 5 × 7 cm (18 × 24 furos, grade de 2,54 mm), com o ESP32 DevKit V1, o transceptor TJA1050 e o conversor RT8272. O fusível fica no fio do pino 16, fora da placa. A ligação elétrica é a de [ligacao-can.md](../ligacao-can.md): só o pino 14 (CAN-L) vai ao transceptor e o CANH fica em 3,3 V por 1 kΩ. O TX do TJA1050 fica preso nos 5 V, então o transceptor nunca transmite.

> **Situação: provisória.** As posições usam medidas de catálogo, que variam entre fabricantes. Antes de soldar, confira com as medidas da tabela abaixo e gere de novo.

## Desenho

**Esquema de ligação** (fora de escala):

![Esquema: OBD, fusível, RT8272, ESP32 e TJA1050 com os resistores](esquema.svg)

**Etapa 1: antes de encaixar o ESP32 e os módulos** (vista de cima). Barras fêmea do ESP32, resistores, fios isolados J1 e J2 e as ilhas de cada módulo:

![Etapa 1: barras do ESP32, resistores R1 a R4, fios J1 e J2 e ilhas dos módulos](etapa1.svg)

**Etapa 2: placa montada** (vista de cima). O ESP32 fica deitado, com a antena para fora da placa à esquerda e o USB à direita:

![Etapa 2: ESP32, TJA1050 e RT8272 montados](etapa2.svg)

**Vista de baixo** (lado da solda, espelhada). Trilhas de fio estanhado, sempre em linha reta:

![Vista de baixo: trilhas de GND, 5 V, 12 V, CAN-L e sinais](baixo.svg)

Cores: vermelho 12 V e 5 V, roxo 12 V depois do fusível, preto GND, laranja 3V3, amarelo RX e D21, azul CAN. Furos indicados como (coluna, linha), na numeração das bordas. Em tamanho real (1:1), para imprimir em 100%: [`etapa1-real.svg`](etapa1-real.svg), [`etapa2-real.svg`](etapa2-real.svg) e [`baixo-real.svg`](baixo-real.svg).

Para gerar de novo: `python3 veiculos/fiat-uno-vivace-2012/placa/gerar_placa.py`.

## Montagem prevista

- **ESP32:** em barras de pinos fêmea, nas linhas 2 e 12, colunas 2 a 16. A antena fica para fora da borda esquerda, longe dos fios. Pinos usados: D21 (6,2), 3V3 (16,2), GND (15,12) e VIN (16,12).
- **Resistores de 1 kΩ, embaixo do ESP32:**
  - R1 vai do D21 ao RX do TJA1050, pelo fio J1;
  - R2 e R3, em série, vão do D21 ao GND. É o divisor que leva os 5 V do RX a 3,3 V;
  - R4 vai do 3V3 ao CANH, pelo fio J2.
- **TJA1050:** preso com fita dupla-face nas linhas 15 a 19, à direita. Os pinos vão às ilhas da linha 14 por fios curtos (ou por barra de pinos, se a ordem bater).
- **RT8272:** preso com fita à esquerda, nas linhas 15 a 20. Os quatro fios dele vão às ilhas da linha 21.
- **Fusível de 1 A, fora da placa:** porta-fusível de linha no fio do pino 16, o mais perto possível do conector OBD, para proteger o fio inteiro. Serve um de lâmina mini ou um de 5 × 20 mm.
- **Cabo OBD:** os quatro fios entram pela borda de baixo: 16 (12,24), 4 (16,24), 5 (17,24) e 14 (18,24).
- **Placa perfurada:** 5 × 7 cm com 18 × 24 furos, o tamanho padrão mais comum. Uma de 4 × 6 cm não serve, porque as barras do ESP32 precisam de 15 colunas.

Antes de ligar o ESP32, regule o RT8272 em **5,0 V** com o fio OUT+ ainda solto.

## Ilhas, trilhas, resistores e fios

**Ilhas de ligação**

| Onde | Furos |
|---|---|
| TJA1050 | RX (11,14) · CANH (12,14) · GND (15,14) · VCC (16,14) · TX (17,14) · CANL (18,14) |
| RT8272 | IN+ (12,21) · IN− (14,21) · OUT− (15,21) · OUT+ (16,21) |
| Cabo OBD | 16, já com o fusível (12,24) · 4 (16,24) · 5 (17,24) · 14 (18,24) |

**Trilhas de solda (lado de baixo)**

| Ligação | Furos |
|---|---|
| D21 → R1 e R2 | (6,2) – (6,3) – (7,3) e (6,3) – (6,4) |
| R2 → R3 | (6,8) – (7,8) |
| GND | (11,8) → (15,8) → (15,24) → (17,24). Passa pelo GND do ESP32 (15,12), pelo GND do TJA1050 (15,14), pelo OUT− (15,21) e chega aos pinos 4 e 5 do OBD |
| IN− no GND | (14,21) – (15,21) |
| 3V3 → R4 | (16,2) – (16,3) |
| 5 V | (16,12) → (16,21). Passa pelo VCC do TJA1050 (16,14) e chega ao OUT+ |
| TX preso no 5 V | (16,14) – (17,14) |
| RX (fim do J1) | (11,13) – (11,14) |
| CANH (fim do J2) | (12,13) – (12,14) |
| 12 V com fusível → IN+ | (12,24) → (12,21) |
| CAN-L | (18,14) → (18,24) |

As trilhas de GND (coluna 15) e de 5 V (coluna 16) correm lado a lado nas linhas 12 a 21: confira com lupa e com o multímetro que não encostam.

**Resistores (1 kΩ, 1/4 W: marrom, preto, vermelho)**

| | Furos | Função |
|---|---|---|
| R1 | (7,3) – (11,3) | D21 → J1 → RX do TJA1050 |
| R2 | (6,4) – (6,8) | D21 → R3 (divisor) |
| R3 | (7,8) – (11,8) | R2 → GND (divisor) |
| R4 | (16,3) – (16,7) | 3V3 → J2 → CANH |

**Fios isolados (por cima da placa, embaixo do ESP32)**

| | Caminho | Função |
|---|---|---|
| J1 | (11,3) → coluna 17 → (11,13) | R1 → RX do TJA1050 |
| J2 | (16,7) → coluna 18 → (12,13) | R4 → CANH do TJA1050 |

**Antes de ligar no carro:** sem nada ligado, não pode haver continuidade entre GND e (12,24), (12,21) ou (16,12). Com o ESP32 fora das barras e o OUT+ do RT8272 solto, regule a saída em 5,0 V. Depois de ligar o OUT+ e encaixar o ESP32, o D21 deve ficar em até 3,4 V.

## Medidas dos componentes

Preencha com o paquímetro e anote a data. Distâncias de centro a centro dos pinos.

| Componente | Medida | Valor | Data |
|---|---|---|---|
| Placa perfurada | Tamanho (mm) e número de furos (colunas × linhas) | Padrão de 5 × 7 cm, 18 × 24 furos (a comprar) | 07/11/2026 |
| ESP32 DevKit V1 (30 pinos) | Comprimento × largura da placa (mm) | 50 × 28; 15 pinos por lado, fileira de 15 com 38 mm (passo de 2,54 mm) | 07/11/2026 |
| | Distância entre as duas fileiras de pinos (mm) | 24,5 por dentro e 25,5 a 26 por fora; cerca de 25,4 de centro a centro (10 furos, linhas 2 e 12) | 07/11/2026 |
| | Ordem dos pinos, com o USB para baixo (confirmar 3V3, GND, VIN e D21) | Confirmada pela foto: com o USB para cima, à esquerda 3V3, GND, D15, D2, D4, RX2, TX2, D5, D18, D19, D21, RX0, TX0, D22, D23; à direita VIN, GND, D13, D12, D14, D27, D26, D25, D33, D32, D35, D34, VN, VP, EN. Igual ao desenho | 07/11/2026 |
| TJA1050 (Teknimas) | Comprimento × largura (mm) | | |
| | Posição e ordem dos pinos | | |
| | Resistência entre CANH e CANL (Ω). Se der cerca de 120 Ω, o resistor de terminação sai | | |
| RT8272 | Comprimento × largura (mm) | | |
| | Posição das ilhas IN+, IN−, OUT+, OUT− | | |
| Fusível de 1 A | Fica no fio do pino 16, fora da placa; não precisa de medida | | 07/11/2026 |
| SN65HVD230 (reserva, a caminho) | Comprimento × largura e ordem dos pinos | | |
| Conector OBD2 macho (a caminho) | Pinos montados (precisa de 4, 5, 14 e 16) | | |
| Cabo Y OBD2 (a caminho) | Pinos ligados em cada ramo | | |

Medidas de catálogo usadas por enquanto: TJA1050 com cerca de 22 × 11,5 mm.
