# arduino-can-listen

Escuta passiva da rede CAN com Arduino Uno + MCP2515 em modo **Listen-Only**: o chip não transmite nada à rede. O programa nunca chama `setNormalMode()` nem `sendMessage()` e para se o modo listen-only não for confirmado no registrador do chip.

- Biblioteca: [autowp/arduino-mcp2515](https://github.com/autowp/arduino-mcp2515) (`autowp-mcp2515` no Gerenciador de Bibliotecas)
- Cristal: `MCP_8MHZ` por padrão; troque no topo do arquivo se o seu for de 16 MHz
- Velocidade: começa em 50 kbit/s e busca 33,3/100/125/250/500 se não chegar nada
- Saída: USB a 500000 baud, formato slcan (`t`/`T`/`r`/`R`), com estados em linhas `#`

Ligação, roteiro e análise: [docs/can-escuta.md](../../docs/can-escuta.md).
