# teste-led

Teste dos LEDs de estado do [`esp32-can-listen`](../esp32-can-listen/README.md#leds-de-estado) 1.4 num ESP32 solto, sem rede CAN. Serve para descobrir se o LED tricolor é anodo ou catodo comum e para conferir o brilho com os resistores.

**Ligação** (a mesma do `esp32-can-listen`), com um resistor em cada cor (220 Ω no vermelho e 100 Ω no verde e no azul dão bom brilho; com 1 kΩ acende fraco, mas dá para validar):

| Perna do LED | Pino do ESP32 |
|---|---|
| Comum (a mais comprida) | D18 |
| Vermelho | TX2 (GPIO17) |
| Verde | RX2 (GPIO16) |
| Azul | D4 |

**Como usar:** grave `teste-led.ino` na placa **ESP32 Dev Module** e abra o *Monitor serial* a **9600 baud**. Cada teste é anunciado antes, com o que deve acontecer, e fica aceso e firme com uma contagem regressiva, seguido de uma pausa apagada:

```
>> Agora vamos testar: a cor VERDE
   O que deve acontecer: acende SO o VERDE, firme, no brilho maximo (pino RX2 (GPIO16))
   Testando a cor VERDE...
   aceso: 5 4 3 2 1 pronto
   apagado (pausa)
```

1. LED azul da placa (D2): aceso, piscando 1 vez por segundo e depois 2 vezes por segundo.
2. Tipo do LED tricolor: cada cor primeiro como anodo comum, depois como catodo comum. As cores acendem só na fase do tipo do seu LED; na outra, nada acende.
3. Cada cor sozinha, acesa e firme, e depois com o brilho subindo e descendo.
4. Os sinais do firmware 1.4, 8 s cada: sem app (azul), sem quadros da rede (verde, 1 piscada por segundo), capturando (verde, 2 piscadas por segundo) e erro (vermelho, rápido). Só cores puras: num LED transparente, misturas como o amarelo aparecem como dois pontos separados.

Depois ele recomeça. Digite **a** (anodo comum) ou **c** (catodo comum) e Enter no Monitor serial para fixar o tipo usado nos passos 3 e 4; o padrão é anodo comum, o tipo do LED do projeto. No `esp32-can-listen`, o tipo vai em `LED_ANODO_COMUM`.
