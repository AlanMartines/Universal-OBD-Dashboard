# esp32-can-listen

Escuta passiva da rede CAN com ESP32 clássico (DevKit de 30 pinos), a 50 kbit/s. Manda os quadros pela USB e pelo Bluetooth clássico, no mesmo formato do `arduino-can-listen`. Por isso, o `roteiro.py` e o `can_capture.py` funcionam com ele pela USB.

Só escuta: o TWAI fica em Listen-Only, sem fila de transmissão, e o TX do transceptor fica preso no nível recessivo.

## Gravar

Faça isto com a placa desligada do carro.

1. Na Arduino IDE, instale o pacote **esp32**, da Espressif (*Ferramentas → Placa → Gerenciador de placas*).
2. Abra `esp32-can-listen.ino` e escolha a placa **ESP32 Dev Module**.
3. Grave na placa. Se a IDE ficar parada em `Connecting...`, segure o botão BOOT até a gravação começar.
4. No *Monitor serial* a 500000 baud deve aparecer `# esp32-can-listen 1.0` e `# listen-only 50 kbps`.

Se faltar memória ao compilar, escolha *Ferramentas → Partition Scheme → Huge APP*.

Ligação e uso: [docs/can-escuta.md](../../docs/can-escuta.md).
