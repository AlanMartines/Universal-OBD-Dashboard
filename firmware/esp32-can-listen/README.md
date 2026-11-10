# esp32-can-listen

Escuta passiva da rede CAN com ESP32 clássico (DevKit de 30 pinos), a 50 kbit/s. Manda os quadros pela USB e pelo Bluetooth clássico, no mesmo formato do `arduino-can-listen`. Por isso, o `roteiro.py` e o `can_capture.py` funcionam com ele pela USB.

Só escuta: o TWAI fica em Listen-Only, sem fila de transmissão, e o TX do transceptor fica preso no nível recessivo.

## Gravar

Faça isto com a placa desligada do carro.

1. Na Arduino IDE, instale o pacote **esp32**, da Espressif (*Ferramentas → Placa → Gerenciador de placas*).
2. Abra `esp32-can-listen.ino` e escolha a placa **ESP32 Dev Module**.
3. Grave na placa. Se a IDE ficar parada em `Connecting...`, segure o botão BOOT até a gravação começar.
4. No *Monitor serial* a 500000 baud deve aparecer `# esp32-can-listen 1.4` e `# listen-only 50 kbps`.

Se faltar memória ao compilar, escolha *Ferramentas → Partition Scheme → Huge APP*.

A velocidade é fixa em `TWAI_TIMING_CONFIG_50KBITS()`, a da rede do Uno Vivace. Em outro carro, ajuste esse valor e o aviso `# listen-only` logo abaixo.

## Sensor BMP180 (opcional)

Temperatura e pressão do lugar onde o módulo fica, no I2C. Serve o módulo GY-68 (com VCC e 3.3V) ou o HW-596 (VIN):

| BMP180 | ESP32 |
|---|---|
| VCC (ou VIN) | 3V3 |
| GND | GND |
| SDA | D25 |
| SCL | D26 |
| 3.3V (só no GY-68) | sem ligação |

Na placa ilhada, o conector do cabo leva o VCC no 5 V: aí use o GY-68, que tem regulador, ligando no pino VCC dele ([placa](../../veiculos/fiat-uno-vivace-2012/placa/README.md)). O D21 e o D22, que são as portas de I2C de costume, ficam com o CAN. A cada 5 s aparece `# bmp180 temp=24.3C pressao=1013.2hPa`. Sem o sensor, aparece uma vez `# bmp180 ausente` e o resto funciona igual. A leitura é direta, pelas fórmulas do datasheet, então não precisa de biblioteca.

Embaixo do painel, perto do OBD, a temperatura medida é a daquele canto, e o calor do ESP32 e do conversor também chega até o sensor. Para medir a temperatura da cabine, leve o sensor com um cabo de quatro fios para um lugar ventilado e longe do sol direto. A pressão serve como está: o interior do carro não é vedado, então ela acompanha a pressão do lado de fora e a altitude.

## Sensor LSM6DS3 (opcional)

Acelerômetro e giroscópio de 6 eixos, no mesmo I2C do BMP180 (SDA no D25, SCL no D26). Serve o módulo de 13 × 18 mm que aceita LSM6DS3 ou BMI160 (o firmware lê o LSM6DS3 e o LSM6DS3TR-C). Ele tem regulador:

| Módulo | Liga em |
|---|---|
| VIN | 5 V (na placa ilhada, o pino VCC do conector do LSM6DS3) |
| GND | GND |
| SDA | D25 |
| SCL | D26 |
| CS | 3V3 do próprio módulo (modo I2C) |
| SA0 | GND do próprio módulo (endereço 0x6A) |
| 3V3, OCS, INT1, INT2, SCX, SDX | sem ligação |

O firmware procura o sensor em 0x6A e em 0x6B, lê a 50 Hz e, a cada 200 ms, manda a média do intervalo e o maior desvio da gravidade:

```
# lsm6ds3 ax=0.012 ay=-0.034 az=0.998 gx=0.1 gy=-0.2 gz=0.0 pico=0.15
```

- **ax, ay, az:** aceleração em g (1 g = gravidade), nos eixos impressos no módulo. Parado e deitado, um deles fica perto de 1.
- **gx, gy, gz:** rotação em graus por segundo.
- **pico:** o maior desvio de 1 g no intervalo, em g. Sobe em buracos, lombadas e impactos.

Fica em ±4 g e ±250 °/s, a 104 Hz. Ao iniciar aparece `# lsm6ds3 ok em 0x6A (id 0x69)`; sem o sensor, uma vez `# lsm6ds3 ausente`. Um id diferente aparece em `# lsm6ds3 id desconhecido` (por exemplo, um BMI160 está em outro endereço e não é lido). No descanso, o sensor também desliga.

Prenda o módulo firme no carro: solto, ele mede a vibração dele mesmo. Ele pode ficar em qualquer posição: o app aprende sozinho onde é "cima" (com o carro parado) e onde é a frente (nas arrancadas e frenagens, comparando com a velocidade do OBD). Se o módulo mudar de posição, o app percebe com o carro parado e aprende de novo. Com isso, mostra a aceleração e a frenagem, a força nas curvas, a inclinação da rua e os buracos na tela Movimento, no histórico e no painel web.

## LEDs de estado

O LED azul da própria placa do ESP32 (D2) pisca conforme o estado. Um LED tricolor (RGB) externo, opcional, mostra o mesmo com cores:

| Situação | LED azul do ESP32 | LED tricolor |
|---|---|---|
| App não conectado | 1 piscada por segundo | azul, 1 por segundo |
| App conectado, mas a rede CAN sem quadros (carro desligado, fio solto) | 1 piscada por segundo | verde, 1 por segundo |
| Capturando: app conectado e quadro chegando no último segundo | 2 piscadas por segundo | verde, 2 por segundo |
| Erro: o transceptor não iniciou (por 10 s, antes de dormir) | rápido | vermelho, rápido |
| Descanso | apagado | apagado |

As piscadas são curtas (80 ms acesas), para o LED passar a maior parte do tempo apagado. O tricolor usa só as cores puras: azul é "sem app", verde é "com app" (devagar sem dados, dobrado capturando) e vermelho é erro. Num LED transparente, misturas como o amarelo aparecem como dois pontos de cor separados.

**Ligação do LED tricolor.** Um resistor de 220 a 330 Ω em cada cor (vermelho, verde e azul), soldado na perna do LED e coberto com termorretrátil. O comum vai direto, sem resistor.

| Perna do LED | Pino do ESP32 |
|---|---|
| Comum (a perna mais comprida) | D18 |
| Vermelho | TX2 (GPIO17) |
| Verde | RX2 (GPIO16) |
| Azul | D4 |

O D18 faz as vezes de 3,3 V ou de GND. Por isso a ligação é a mesma para os dois tipos de LED, e só muda uma linha no começo do programa:

- **Anodo comum** (o comum é o positivo): `LED_ANODO_COMUM = true`, o padrão (o LED do projeto, conferido com o [`teste-led`](../teste-led/README.md) em 10/11/2026).
- **Catodo comum** (o comum é o negativo): `LED_ANODO_COMUM = false`.

Para descobrir o tipo, use o multímetro na escala de diodo. Com a ponta **preta** no comum e a **vermelha** numa das outras pernas, se a cor acender (fraquinho), é catodo comum. Se só acender com as pontas trocadas, é anodo comum.

Na [placa ilhada](../../veiculos/fiat-uno-vivace-2012/placa/README.md), o LED liga num conector da linha 1, logo acima desses pinos. Para testar antes, dá para ligar com jumpers fêmea direto nos pinos do ESP32, sem esquecer os resistores. Sem LED tricolor, deixe `LED_RGB = true`: os pinos ficam sem efeito. Use `false` para deixá-los livres para outro uso.

Os pinos das cores ficam com a menor corrente de saída do ESP32 (cerca de 5 mA), uma proteção a mais se faltar algum resistor. O D2, o D5, o D12 e o D15 foram evitados, porque mexem na partida do ESP32.

## Modo descanso

O pino 16 do OBD tem 12 V o tempo todo, então o ESP32 pode ficar ligado no carro direto:

- **Para dormir:** passados **2 min sem nenhum quadro** na rede (carro desligado, rede dormindo), aparece `# descanso: rede parada ha 120 s`. O ESP32 então desliga o Bluetooth e o TWAI e entra em sono leve.
- **Para acordar:** o primeiro sinal da rede no RX (chave, porta, alarme) acorda o ESP32. Ele reinicia do zero e volta a escutar em cerca de 2 s, com `# acordou: atividade na rede CAN`. O app, que tenta reconectar sozinho, volta a receber os quadros.
- **Só escuta:** a rede é que acorda o ESP32. Ele não envia nada para acordá-la.
- **Se a linha do RX estiver presa em nível baixo:** ele não dorme, porque acordaria na hora.
- **Se o TWAI não iniciar:** ele dorme 10 min e tenta de novo, em vez de ficar acordado.

Consumo estimado em 12 V, sem medição:

| Situação | Consumo | Em 48 h |
|---|---|---|
| Acordado, com o Bluetooth | 50 a 70 mA | cerca de 3 Ah |
| Em descanso | 8 a 15 mA, quase tudo do TJA1050, do LED e do regulador da placa | cerca de 0,6 Ah, perto de 1% de uma bateria de 50 Ah |

Para usar na bancada pela USB sem dormir, grave com `REST_ENABLED = false`. O tempo até dormir fica em `IDLE_MS`.

Uso geral: [docs/can-escuta.md](../../docs/can-escuta.md). Ligação de cada carro: [veiculos/](../../veiculos/README.md).
