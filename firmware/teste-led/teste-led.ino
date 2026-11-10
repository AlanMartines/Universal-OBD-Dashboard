/*
 * Teste dos LEDs de estado do esp32-can-listen 1.4, num ESP32 solto (sem rede CAN).
 *
 * Mostra cada passo no Monitor serial a 9600 baud:
 *   1. LED azul da placa (D2): aceso, piscando e com o brilho subindo e descendo.
 *   2. Tipo do LED tricolor: cada cor como catodo comum e depois como anodo comum.
 *      As cores acendem só na fase do tipo do seu LED; na outra, nada acende.
 *   3. Brilho de cada cor, subindo e descendo.
 *   4. Misturas: amarelo, ciano, magenta e branco.
 *   5. Os sinais do firmware 1.4: sem app, sem quadros da rede, capturando e erro.
 * Depois recomeça. Digite "a" (anodo comum) ou "c" (catodo comum) e Enter para fixar o tipo
 * usado nos passos 3 a 5; o padrão é anodo comum, como no esp32-can-listen.
 *
 * Ligação (a mesma do esp32-can-listen 1.4), com um resistor de 220 a 330 Ω em cada cor:
 *   comum (a perna mais comprida) no D18, vermelho no TX2 (GPIO17), verde no RX2 (GPIO16), azul no D4.
 * O D18 faz as vezes de 3,3 V (anodo comum) ou de GND (catodo comum).
 *
 * Placa: "ESP32 Dev Module", no pacote esp32 da Espressif.
 */

const int LED_PLACA = 2;
const int LED_COMUM = 18;
const int LED_R = 17, LED_G = 16, LED_B = 4;
const int CORES[] = {LED_R, LED_G, LED_B};
const char *const NOMES[] = {"vermelho", "verde", "azul"};

bool anodo = true;   // tipo usado nos passos 3 a 5 (muda pelo Monitor serial)

// Brilho de 0 a 255 numa cor, já invertido no anodo comum (a cor acende com o pino em nível baixo).
void cor(int pin, int brilho, bool comoAnodo) {
  analogWrite(pin, comoAnodo ? 255 - brilho : brilho);
}

void rgb(int r, int g, int b, bool comoAnodo) {
  digitalWrite(LED_COMUM, comoAnodo ? HIGH : LOW);
  cor(LED_R, r, comoAnodo);
  cor(LED_G, g, comoAnodo);
  cor(LED_B, b, comoAnodo);
}

void apagaTudo(bool comoAnodo) {
  rgb(0, 0, 0, comoAnodo);
  analogWrite(LED_PLACA, 0);
}

// Espera lendo o Monitor serial: "a" ou "c" mudam o tipo.
void espera(unsigned long ms) {
  unsigned long t0 = millis();
  while (millis() - t0 < ms) {
    while (Serial.available()) {
      char c = Serial.read();
      if (c == 'a' || c == 'A') {
        anodo = true;
        Serial.println(">> tipo fixado: ANODO comum (passos 3 a 5)");
      } else if (c == 'c' || c == 'C') {
        anodo = false;
        Serial.println(">> tipo fixado: CATODO comum (passos 3 a 5)");
      }
    }
    delay(5);
  }
}

void passo(const char *texto) {
  Serial.println();
  Serial.println(texto);
}

void ledPlaca() {
  passo("1. LED azul da placa (D2)");
  Serial.println("   aceso por 3 s");
  analogWrite(LED_PLACA, 255);
  espera(3000);
  Serial.println("   piscando 1 vez por segundo por 4 s");
  for (int i = 0; i < 4; i++) {
    analogWrite(LED_PLACA, 255);
    espera(80);
    analogWrite(LED_PLACA, 0);
    espera(920);
  }
  Serial.println("   piscando 2 vezes por segundo por 4 s");
  for (int i = 0; i < 8; i++) {
    analogWrite(LED_PLACA, 255);
    espera(80);
    analogWrite(LED_PLACA, 0);
    espera(420);
  }
  Serial.println("   brilho subindo e descendo");
  for (int v = 0; v <= 255; v += 5) { analogWrite(LED_PLACA, v); espera(15); }
  for (int v = 255; v >= 0; v -= 5) { analogWrite(LED_PLACA, v); espera(15); }
  analogWrite(LED_PLACA, 0);
}

void tipoDoLed() {
  for (int fase = 0; fase < 2; fase++) {
    bool comoAnodo = fase == 1;
    passo(comoAnodo ? "2b. LED tricolor como ANODO comum (D18 em 3,3 V)"
                    : "2a. LED tricolor como CATODO comum (D18 em 0 V)");
    Serial.println("   se as cores acenderem uma de cada vez, nesta ordem, o seu LED e deste tipo;");
    Serial.println("   na fase do outro tipo, nada acende");
    for (int i = 0; i < 3; i++) {
      Serial.print("   ");
      Serial.print(NOMES[i]);
      Serial.println(" por 2 s");
      rgb(i == 0 ? 255 : 0, i == 1 ? 255 : 0, i == 2 ? 255 : 0, comoAnodo);
      espera(2000);
    }
    Serial.println("   apagado por 2 s");
    apagaTudo(comoAnodo);
    espera(2000);
  }
  Serial.println("   >> no Monitor serial, digite a (anodo) ou c (catodo) e Enter para fixar o tipo");
  Serial.print("   >> tipo em uso agora: ");
  Serial.println(anodo ? "ANODO comum" : "CATODO comum");
  espera(4000);
}

void brilho() {
  passo(anodo ? "3. Brilho de cada cor (anodo comum)" : "3. Brilho de cada cor (catodo comum)");
  for (int i = 0; i < 3; i++) {
    Serial.print("   ");
    Serial.print(NOMES[i]);
    Serial.println(": subindo e descendo");
    digitalWrite(LED_COMUM, anodo ? HIGH : LOW);
    for (int v = 0; v <= 255; v += 3) { cor(CORES[i], v, anodo); espera(12); }
    for (int v = 255; v >= 0; v -= 3) { cor(CORES[i], v, anodo); espera(12); }
    cor(CORES[i], 0, anodo);
    espera(300);
  }
}

void misturas() {
  passo("4. Misturas de cor, 2 s cada");
  const struct { const char *nome; int r, g, b; } MIX[] = {
    {"amarelo (vermelho + verde)", 255, 255, 0},
    {"ciano (verde + azul)", 0, 255, 255},
    {"magenta (vermelho + azul)", 255, 0, 255},
    {"branco (as tres)", 255, 255, 255},
  };
  for (const auto &m : MIX) {
    Serial.print("   ");
    Serial.println(m.nome);
    rgb(m.r, m.g, m.b, anodo);
    espera(2000);
  }
  apagaTudo(anodo);
}

// Piscadas do esp32-can-listen 1.4: curtas (80 ms), no LED da placa e no tricolor ao mesmo tempo.
void sinal(const char *nome, int r, int g, int b, int porSegundo, bool rapido) {
  Serial.print("   ");
  Serial.println(nome);
  unsigned long t0 = millis();
  while (millis() - t0 < 6000) {
    unsigned long t = millis() - t0;
    bool aceso = rapido ? t % 200 < 100 : (t % 1000 < 80 || (porSegundo == 2 && t % 1000 >= 500 && t % 1000 < 580));
    analogWrite(LED_PLACA, aceso ? 255 : 0);
    rgb(aceso ? r : 0, aceso ? g : 0, aceso ? b : 0, anodo);
    espera(10);
  }
  apagaTudo(anodo);
  espera(800);
}

void sinais() {
  passo("5. Sinais do firmware 1.4, 6 s cada");
  sinal("app nao conectado: azul, 1 piscada por segundo", 0, 0, 255, 1, false);
  sinal("app conectado, rede sem quadros: amarelo, 1 por segundo", 255, 255, 0, 1, false);
  sinal("capturando: verde, 2 por segundo", 0, 255, 0, 2, false);
  sinal("erro: vermelho, rapido", 255, 0, 0, 0, true);
}

void setup() {
  Serial.begin(9600);
  pinMode(LED_PLACA, OUTPUT);
  pinMode(LED_COMUM, OUTPUT);
  for (int pin : CORES) pinMode(pin, OUTPUT);
  apagaTudo(anodo);
  delay(1500);
  Serial.println();
  Serial.println("# teste-led 1.0");
  Serial.println("# comum no D18, vermelho no TX2 (GPIO17), verde no RX2 (GPIO16), azul no D4");
  Serial.println("# digite a (anodo) ou c (catodo) e Enter a qualquer momento para fixar o tipo");
}

void loop() {
  Serial.println();
  Serial.println("===== inicio do teste =====");
  ledPlaca();
  tipoDoLed();
  brilho();
  misturas();
  sinais();
  Serial.println();
  Serial.println("===== fim; recomeca em 3 s =====");
  espera(3000);
}
