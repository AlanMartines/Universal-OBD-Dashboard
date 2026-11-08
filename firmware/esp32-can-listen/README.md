# esp32-can-listen

Escuta passiva da rede CAN com ESP32 clássico (DevKit de 30 pinos), a 50 kbit/s. Manda os quadros pela USB e pelo Bluetooth clássico, no mesmo formato do `arduino-can-listen`. Por isso, o `roteiro.py` e o `can_capture.py` funcionam com ele pela USB.

Só escuta: o TWAI fica em Listen-Only, sem fila de transmissão, e o TX do transceptor fica preso no nível recessivo.

## Gravar

Faça isto com a placa desligada do carro.

1. Na Arduino IDE, instale o pacote **esp32**, da Espressif (*Ferramentas → Placa → Gerenciador de placas*).
2. Abra `esp32-can-listen.ino` e escolha a placa **ESP32 Dev Module**.
3. Grave na placa. Se a IDE ficar parada em `Connecting...`, segure o botão BOOT até a gravação começar.
4. No *Monitor serial* a 500000 baud deve aparecer `# esp32-can-listen 1.1` e `# listen-only 50 kbps`.

Se faltar memória ao compilar, escolha *Ferramentas → Partition Scheme → Huge APP*.

A velocidade é fixa em `TWAI_TIMING_CONFIG_50KBITS()`, a da rede do Uno Vivace. Em outro carro, ajuste esse valor e o aviso `# listen-only` logo abaixo.

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
