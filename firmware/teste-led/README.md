# teste-led

Teste dos LEDs de estado do [`esp32-can-listen`](../esp32-can-listen/README.md#leds-de-estado) 1.4 num ESP32 solto, sem rede CAN. Serve para descobrir se o LED tricolor é anodo ou catodo comum e para conferir o brilho com os resistores.

**Ligação** (a mesma do `esp32-can-listen`), com um resistor de 220 a 330 Ω em cada cor:

| Perna do LED | Pino do ESP32 |
|---|---|
| Comum (a mais comprida) | D18 |
| Vermelho | TX2 (GPIO17) |
| Verde | RX2 (GPIO16) |
| Azul | D4 |

**Como usar:** grave `teste-led.ino` na placa **ESP32 Dev Module** e abra o *Monitor serial* a **9600 baud**. Cada passo aparece escrito:

1. LED azul da placa (D2): aceso, piscando 1 e 2 vezes por segundo, e com o brilho subindo e descendo.
2. Tipo do LED tricolor: cada cor primeiro como catodo comum, depois como anodo comum. As cores acendem só na fase do tipo do seu LED; na outra, nada acende.
3. Brilho de cada cor, subindo e descendo.
4. Misturas: amarelo, ciano, magenta e branco.
5. Os sinais do firmware 1.4: sem app (azul), sem quadros da rede (amarelo), capturando (verde, 2 piscadas por segundo) e erro (vermelho, rápido).

Depois ele recomeça. Digite **a** (anodo comum) ou **c** (catodo comum) e Enter no Monitor serial para fixar o tipo usado nos passos 3 a 5; o padrão é anodo comum, o tipo do LED do projeto. No `esp32-can-listen`, o tipo vai em `LED_ANODO_COMUM`.
