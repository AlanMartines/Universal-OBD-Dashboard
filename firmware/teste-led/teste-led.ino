/*
 * Teste dos LEDs de estado do esp32-can-listen 1.4, num ESP32 solto (sem rede CAN).
 *
 * No Monitor serial a 9600 baud, cada teste é anunciado antes ("Agora vamos testar..."), diz o que
 * deve acontecer, fica aceso e firme com uma contagem regressiva e termina com uma pausa apagada:
 *   1. LED azul da placa (D2): aceso, piscando e com o brilho subindo e descendo.
 *   2. Tipo do LED tricolor: cada cor como anodo comum e depois como catodo comum.
 *      As cores acendem só na fase do tipo do seu LED; na outra, nada acende.
 *   3. Cada cor sozinha, acesa e firme, e depois com o brilho subindo e descendo.
 *   4. Misturas: amarelo, ciano, magenta e branco.
 *   5. Os sinais do firmware 1.4: sem app, sem quadros da rede, capturando e erro.
 * Depois recomeça. Digite "a" (anodo comum) ou "c" (catodo comum) e Enter para fixar o tipo
 * usado nos passos 3 a 5; o padrão é anodo comum, como no esp32-can-listen.
 *
 * Ligação (a mesma do esp32-can-listen 1.4), com um resistor em cada cor (220 Ω no vermelho e 100 Ω
 * no verde e no azul dão bom brilho; com 1 kΩ acende fraco, mas dá para validar):
 *   comum (a perna mais comprida) no D18, vermelho no TX2 (GPIO17), verde no RX2 (GPIO16), azul no D4.
 * O D18 faz as vezes de 3,3 V (anodo comum) ou de GND (catodo comum).
 *
 * Placa: "ESP32 Dev Module", no pacote esp32 da Espressif.
 */

const int LED_PLACA = 2;
const int LED_COMUM = 18;
const int LED_R = 17, LED_G = 16, LED_B = 4;
const int CORES[] = {LED_R, LED_G, LED_B};
const char *const NOMES[] = {"VERMELHO", "VERDE", "AZUL"};
const char *const PINOS[] = {"TX2 (GPIO17)", "RX2 (GPIO16)", "D4"};

const unsigned long FIRME_MS = 5000;   // quanto tempo cada cor fica acesa
const unsigned long PAUSA_MS = 1500;   // apagado entre um teste e outro

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

const char *tipo(bool comoAnodo) {
  return comoAnodo ? "ANODO comum" : "CATODO comum";
}

// Espera lendo o Monitor serial: "a" ou "c" mudam o tipo.
void espera(unsigned long ms) {
  unsigned long t0 = millis();
  while (millis() - t0 < ms) {
    while (Serial.available()) {
      char c = Serial.read();
      if (c == 'a' || c == 'A') {
        anodo = true;
        Serial.println("   >> tipo fixado: ANODO comum (vale a partir do proximo teste)");
      } else if (c == 'c' || c == 'C') {
        anodo = false;
        Serial.println("   >> tipo fixado: CATODO comum (vale a partir do proximo teste)");
      }
    }
    delay(5);
  }
}

// Mantém o que estiver aceso, mostrando a contagem regressiva em segundos: "5 4 3 2 1".
void contagem(unsigned long ms) {
  Serial.print("   aceso: ");
  for (unsigned long s = (ms + 999) / 1000; s > 0; s--) {
    Serial.print(s);
    Serial.print(' ');
    espera(1000);
  }
  Serial.println("pronto");
}

void pausa(bool comoAnodo) {
  apagaTudo(comoAnodo);
  Serial.println("   apagado (pausa)");
  espera(PAUSA_MS);
}

void titulo(const char *texto) {
  Serial.println();
  Serial.println("------------------------------------------------------------");
  Serial.println(texto);
  Serial.println("------------------------------------------------------------");
}

// "Agora vamos testar..." e o que deve acontecer; espera 1,5 s para dar tempo de ler.
void anuncia(const char *oque, const char *esperado) {
  Serial.println();
  Serial.print(">> Agora vamos testar: ");
  Serial.println(oque);
  Serial.print("   O que deve acontecer: ");
  Serial.println(esperado);
  espera(1500);
  Serial.print("   Testando ");
  Serial.print(oque);
  Serial.println("...");
}

void ledPlaca() {
  titulo("1. LED AZUL DA PLACA DO ESP32 (D2)");
  anuncia("o LED azul da placa, aceso", "o LED azul da placa (perto do USB) fica aceso e firme");
  analogWrite(LED_PLACA, 255);
  contagem(FIRME_MS);
  pausa(anodo);

  anuncia("o LED azul piscando 1 vez por segundo", "piscadas curtas, uma por segundo (sinal de 'sem app')");
  for (int i = 0; i < 5; i++) {
    analogWrite(LED_PLACA, 255);
    espera(80);
    analogWrite(LED_PLACA, 0);
    espera(920);
  }
  Serial.println("   pronto");
  pausa(anodo);

  anuncia("o LED azul piscando 2 vezes por segundo", "piscadas curtas, duas por segundo (sinal de 'capturando')");
  for (int i = 0; i < 10; i++) {
    analogWrite(LED_PLACA, 255);
    espera(80);
    analogWrite(LED_PLACA, 0);
    espera(420);
  }
  Serial.println("   pronto");
  pausa(anodo);
}

void tipoDoLed() {
  titulo("2. TIPO DO LED TRICOLOR (anodo ou catodo comum)");
  Serial.println("   Cada cor acende sozinha, primeiro como anodo comum e depois como catodo comum.");
  Serial.println("   Na fase do tipo do seu LED, as cores acendem; na outra, nada acende.");
  for (int fase = 0; fase < 2; fase++) {
    bool comoAnodo = fase == 0;
    Serial.println();
    Serial.print("== Fase ");
    Serial.print(fase + 1);
    Serial.print(": como ");
    Serial.print(tipo(comoAnodo));
    Serial.println(comoAnodo ? " (D18 em 3,3 V)" : " (D18 em 0 V)");
    for (int i = 0; i < 3; i++) {
      char oque[48], esperado[96];
      snprintf(oque, sizeof(oque), "a cor %s como %s", NOMES[i], tipo(comoAnodo));
      snprintf(esperado, sizeof(esperado), "se o LED for %s, acende SO o %s (pino %s)", tipo(comoAnodo), NOMES[i], PINOS[i]);
      anuncia(oque, esperado);
      rgb(i == 0 ? 255 : 0, i == 1 ? 255 : 0, i == 2 ? 255 : 0, comoAnodo);
      contagem(3000);
      pausa(comoAnodo);
    }
  }
  Serial.println();
  Serial.print("   Tipo em uso nos proximos testes: ");
  Serial.println(tipo(anodo));
  Serial.println("   Para mudar, digite a (anodo) ou c (catodo) e Enter.");
  espera(3000);
}

void cadaCor() {
  titulo("3. CADA COR SOZINHA");
  for (int i = 0; i < 3; i++) {
    char oque[40], esperado[96];
    snprintf(oque, sizeof(oque), "a cor %s", NOMES[i]);
    snprintf(esperado, sizeof(esperado), "acende SO o %s, firme, no brilho maximo (pino %s)", NOMES[i], PINOS[i]);
    anuncia(oque, esperado);
    rgb(i == 0 ? 255 : 0, i == 1 ? 255 : 0, i == 2 ? 255 : 0, anodo);
    contagem(FIRME_MS);

    snprintf(oque, sizeof(oque), "o brilho do %s", NOMES[i]);
    snprintf(esperado, sizeof(esperado), "o %s acende devagar ate o maximo e apaga devagar, 2 vezes", NOMES[i]);
    anuncia(oque, esperado);
    digitalWrite(LED_COMUM, anodo ? HIGH : LOW);
    for (int volta = 0; volta < 2; volta++) {
      for (int v = 0; v <= 255; v += 3) { cor(CORES[i], v, anodo); espera(12); }
      for (int v = 255; v >= 0; v -= 3) { cor(CORES[i], v, anodo); espera(12); }
    }
    Serial.println("   pronto");
    pausa(anodo);
  }
}

void misturas() {
  titulo("4. MISTURAS DE COR");
  const struct { const char *nome; const char *como; int r, g, b; } MIX[] = {
    {"AMARELO", "vermelho + verde juntos", 255, 255, 0},
    {"CIANO", "verde + azul juntos", 0, 255, 255},
    {"MAGENTA", "vermelho + azul juntos", 255, 0, 255},
    {"BRANCO", "as tres cores juntas", 255, 255, 255},
  };
  for (const auto &m : MIX) {
    char oque[32], esperado[80];
    snprintf(oque, sizeof(oque), "a cor %s", m.nome);
    snprintf(esperado, sizeof(esperado), "%s, firme (%s)", m.nome, m.como);
    anuncia(oque, esperado);
    rgb(m.r, m.g, m.b, anodo);
    contagem(FIRME_MS);
    pausa(anodo);
  }
}

// Piscadas do esp32-can-listen 1.4: curtas (80 ms), no LED da placa e no tricolor ao mesmo tempo.
void sinal(const char *nome, const char *esperado, int r, int g, int b, int porSegundo, bool rapido) {
  anuncia(nome, esperado);
  unsigned long t0 = millis();
  while (millis() - t0 < 8000) {
    unsigned long t = millis() - t0;
    bool aceso = rapido ? t % 200 < 100 : (t % 1000 < 80 || (porSegundo == 2 && t % 1000 >= 500 && t % 1000 < 580));
    analogWrite(LED_PLACA, aceso ? 255 : 0);
    rgb(aceso ? r : 0, aceso ? g : 0, aceso ? b : 0, anodo);
    espera(10);
  }
  Serial.println("   pronto");
  pausa(anodo);
}

void sinais() {
  titulo("5. SINAIS DO FIRMWARE 1.4 (8 s cada, LED da placa e tricolor juntos)");
  sinal("o sinal 'app nao conectado'", "AZUL, 1 piscada curta por segundo", 0, 0, 255, 1, false);
  sinal("o sinal 'app conectado, rede sem quadros'", "AMARELO, 1 piscada curta por segundo", 255, 255, 0, 1, false);
  sinal("o sinal 'capturando'", "VERDE, 2 piscadas curtas por segundo", 0, 255, 0, 2, false);
  sinal("o sinal 'erro'", "VERMELHO, piscando rapido (5 vezes por segundo)", 255, 0, 0, 0, true);
}

void setup() {
  Serial.begin(9600);
  pinMode(LED_PLACA, OUTPUT);
  pinMode(LED_COMUM, OUTPUT);
  for (int pin : CORES) pinMode(pin, OUTPUT);
  apagaTudo(anodo);
  delay(1500);
  Serial.println();
  Serial.println("# teste-led 1.1");
  Serial.println("# ligacao: comum no D18, vermelho no TX2 (GPIO17), verde no RX2 (GPIO16), azul no D4");
  Serial.print("# tipo do LED em uso: ");
  Serial.println(tipo(anodo));
  Serial.println("# digite a (anodo) ou c (catodo) e Enter a qualquer momento para mudar");
}

void loop() {
  Serial.println();
  Serial.println("################ INICIO DO TESTE ################");
  ledPlaca();
  tipoDoLed();
  cadaCor();
  misturas();
  sinais();
  Serial.println();
  Serial.println("################ FIM DO TESTE: recomeca em 5 s ################");
  espera(5000);
}
