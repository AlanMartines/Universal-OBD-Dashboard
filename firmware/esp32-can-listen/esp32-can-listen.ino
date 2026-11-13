/*
 * Escuta passiva da rede CAN com ESP32 clássico + transceptor (TJA1050 ou SN65HVD230).
 *
 * O controlador TWAI do ESP32 fica em modo Listen-Only: não envia quadros, ACK nem quadros
 * de erro. A fila de transmissão é zero, e este programa nunca chama twai_transmit(). A trava
 * final é física: o TX do transceptor fica preso no nível recessivo, sem ligação com o ESP32.
 *
 * Saída pela USB a 500000 baud e pelo Bluetooth clássico (SPP), uma linha por quadro no
 * mesmo formato slcan do firmware/arduino-can-listen, para usar as mesmas ferramentas:
 *   t1238AABBCCDDEEFF0011   quadro padrão: t + ID (3 hex) + tamanho + dados
 *   T1234567820011          quadro estendido: T + ID (8 hex) + tamanho + dados
 *   r1230 / R123456780      pedido remoto (RTR) recebido
 * Linhas começadas por '#' são mensagens de estado.
 *
 * O que chega pela USB ou pelo Bluetooth é ignorado: o programa não recebe comandos.
 *
 * Modo descanso: o pino 16 do OBD tem 12 V o tempo todo. Sem quadros na rede por IDLE_MS (o carro
 * desligado faz a rede dormir), o programa desliga o Bluetooth e o TWAI e põe o ESP32 em sono leve.
 * O primeiro bit dominante no RX (a rede acordando: chave, porta, alarme) acorda o ESP32, que
 * reinicia do zero e volta a escutar em cerca de 2 s. Nada é enviado à rede para acordá-la.
 *
 * Sensor opcional BMP180 (GY-68 / HW-596) no I2C, SDA em D25 e SCL em D26 (D21 e D22 são do CAN):
 * temperatura e pressão do lugar onde o módulo está, a cada AMB_MS, numa linha de estado
 *   # bmp180 temp=24.3C pressao=1013.2hPa
 * Sem o sensor ligado, aparece uma vez "# bmp180 ausente" e o resto segue igual.
 *
 * Sensor opcional LSM6DS3 (acelerômetro e giroscópio, módulo de 13 x 18 mm) no mesmo I2C, endereço 0x6A
 * (SA0 no GND) ou 0x6B, com CS no 3V3. Lido a 50 Hz; a cada IMU_MS sai a média do intervalo e o maior
 * desvio da gravidade (buracos e impactos):
 *   # lsm6ds3 ax=0.012 ay=-0.034 az=0.998 gx=0.1 gy=-0.2 gz=0.0 pico=0.15
 * ax, ay e az em g (gravidade); gx, gy e gz em graus por segundo; pico em g. Os eixos são os impressos no
 * módulo: o app converte para frente, lado e cima do carro depois de calibrar com o carro parado.
 * Sem o sensor, aparece uma vez "# lsm6ds3 ausente". No descanso, o sensor também desliga.
 *
 * Magnetômetro opcional (bússola), no mesmo I2C: placa GY-273, que sai com um de três chips, achado sozinho
 * pelo endereço e pela identificação: QMC5883L (0x0D), QMC5883P (0x2C) ou HMC5883L (0x1E). A cada MAG_MS sai a
 * média do intervalo, em microtesla (µT), nos eixos impressos no módulo:
 *   # mag x=12.3 y=-4.5 z=30.1
 * Na partida: "# mag ok qmc5883l em 0x0D" (ou o chip achado), ou "# mag ausente". O app calibra a bússola sozinho
 * pelo rumo do GPS: não precisa alinhar o módulo com o carro, só prendê-lo firme e longe de fios de força e ímãs
 * (alto-falante). No descanso, o magnetômetro também desliga.
 *
 * LEDs de estado: o azul da própria placa (D2) e, opcional, um LED tricolor (RGB) externo com um resistor em
 * cada cor, no conector da placa: comum no D18, vermelho no TX2 (GPIO17), verde no RX2 (GPIO16) e azul no D4.
 * O D18 faz as vezes de 3V3 (anodo comum) ou de GND (catodo comum), conforme LED_ANODO_COMUM: a ligação é a
 * mesma para os dois tipos de LED. Piscadas curtas:
 *   app não conectado ............. 1 por segundo (tricolor azul)
 *   app conectado, rede sem quadros  1 por segundo (tricolor verde)
 *   capturando (quadro no último 1 s) 2 por segundo (tricolor verde)
 *   erro (transceptor não iniciou) . rápido (tricolor vermelho), antes de dormir
 *   descanso ....................... apagados
 * Placa: "ESP32 Dev Module", no pacote esp32 da Espressif. Guia: docs/can-escuta.md.
 */
#include <BluetoothSerial.h>
#include <Wire.h>
#include "driver/gpio.h"
#include "driver/twai.h"
#include "esp_sleep.h"

const gpio_num_t RX_PIN = GPIO_NUM_21;  // recebe do transceptor; TJA1050 passa por divisor de tensão
const gpio_num_t TX_PIN = GPIO_NUM_22;  // exigido pelo driver; deixar sem ligação
const char *const BT_NAME = "OBD-CAN-Escuta";

// Intervalo das estatísticas.
const unsigned long STATS_MS = 10000;

// Modo descanso: tempo sem nenhum quadro até dormir. false deixa sempre acordado (bancada pela USB).
const bool REST_ENABLED = true;
const unsigned long IDLE_MS = 120000;
// Marca que sobrevive ao reinício: diz que o ESP32 acordou do descanso.
const uint32_t REST_MAGIC = 0x52455354;
RTC_NOINIT_ATTR uint32_t restMark;

// BMP180 (opcional): I2C fora dos pinos do CAN.
const int I2C_SDA = 25;
const int I2C_SCL = 26;
const uint8_t BMP_ADDR = 0x77;
const unsigned long AMB_MS = 5000;   // o app descarta leituras com mais de 10 s

// LSM6DS3 (opcional), no mesmo I2C. Leitura a 50 Hz, uma linha a cada IMU_MS (média e pico do intervalo).
const uint8_t LSM_ADDRS[] = {0x6A, 0x6B};  // SA0 no GND ou no 3V3
const unsigned long IMU_SAMPLE_MS = 20;
const unsigned long IMU_MS = 200;

// Magnetômetro (opcional), no mesmo I2C. Leitura a 20 Hz, uma linha a cada MAG_MS (média do intervalo).
const unsigned long MAG_SAMPLE_MS = 50;
const unsigned long MAG_MS = 200;

// LEDs de estado (veja o cabeçalho). O LED da placa acende com nível alto.
const int LED_PLACA = 2;
const bool LED_RGB = true;           // false se não houver LED tricolor (os pinos ficam livres)
const bool LED_ANODO_COMUM = true;   // true: anodo comum (D18 em 3,3 V), o do projeto; false: catodo comum (D18 em 0 V)
const int LED_COMUM = 18;
const int LED_R = 17, LED_G = 16, LED_B = 4;
const unsigned long CAPTURA_MS = 1000;  // quadro mais recente que isso conta como "capturando"
const unsigned long PISCA_MS = 80;      // tempo aceso de cada piscada

enum Estado { SEM_APP, SEM_REDE, CAPTURANDO, ERRO };
// Só as cores puras: num LED transparente, as misturas aparecem como pontos separados. Azul: sem app; verde: com app
// (1 piscada sem quadros, 2 capturando); vermelho: erro.
const bool COR[][3] = {{false, false, true}, {false, true, false}, {false, true, false}, {true, false, false}};  // R, G, B

BluetoothSerial bt;
unsigned long lastAmb = 0;
unsigned long lastImuSample = 0;
unsigned long lastImu = 0;
unsigned long lastMagSample = 0;
unsigned long lastMag = 0;
unsigned long lastStats = 0;
unsigned long lastFrame = 0;
unsigned long frames = 0;

// Manda a mesma linha para a USB e para quem estiver conectado no Bluetooth.
void sendLine(const char *line) {
  Serial.println(line);
  if (bt.hasClient()) bt.println(line);
}

// Aceso ou apagado agora, no padrão de piscadas do estado.
bool ledAceso(Estado e, unsigned long now) {
  if (e == ERRO) return now % 200 < 100;
  unsigned long f = now % 1000;
  return f < PISCA_MS || (e == CAPTURANDO && f >= 500 && f < 500 + PISCA_MS);
}

void ledRgb(bool r, bool g, bool b) {
  if (!LED_RGB) return;
  // No anodo comum a cor acende com o pino em nível baixo
  digitalWrite(LED_R, r != LED_ANODO_COMUM ? HIGH : LOW);
  digitalWrite(LED_G, g != LED_ANODO_COMUM ? HIGH : LOW);
  digitalWrite(LED_B, b != LED_ANODO_COMUM ? HIGH : LOW);
}

void ledsInit() {
  pinMode(LED_PLACA, OUTPUT);
  digitalWrite(LED_PLACA, LOW);
  if (LED_RGB) {
    // O comum leva a corrente das cores acesas juntas: força máxima. Fica em 3,3 V ou 0 V o tempo todo.
    pinMode(LED_COMUM, OUTPUT);
    gpio_set_drive_capability((gpio_num_t)LED_COMUM, GPIO_DRIVE_CAP_3);
    digitalWrite(LED_COMUM, LED_ANODO_COMUM ? HIGH : LOW);
    for (int pin : {LED_R, LED_G, LED_B}) {
      pinMode(pin, OUTPUT);
      // Corrente mínima (cerca de 5 mA): protege o LED e o pino se faltar o resistor
      gpio_set_drive_capability((gpio_num_t)pin, GPIO_DRIVE_CAP_0);
    }
  }
  ledRgb(false, false, false);
}

void leds(Estado e, unsigned long now) {
  bool on = ledAceso(e, now);
  digitalWrite(LED_PLACA, on ? HIGH : LOW);
  ledRgb(on && COR[e][0], on && COR[e][1], on && COR[e][2]);
}

void ledsOff() {
  digitalWrite(LED_PLACA, LOW);
  ledRgb(false, false, false);
}

void halt(const char *why) {
  char line[80];
  snprintf(line, sizeof(line), "# ERRO %s", why);
  sendLine(line);
  sendLine("# parado: nada foi enviado a rede");
  if (!REST_ENABLED) for (;;) { leds(ERRO, millis()); delay(10); }
  // Pisca o erro por 10 s, para dar tempo de ver
  for (unsigned long t0 = millis(); millis() - t0 < 10000;) { leds(ERRO, millis()); delay(10); }
  ledsOff();
  // Ligado no carro: em vez de ficar acordado gastando bateria, dorme 10 min e tenta de novo.
  sendLine("# nova tentativa em 10 min");
  Serial.flush();
  esp_sleep_enable_timer_wakeup(600ULL * 1000000ULL);
  esp_deep_sleep_start();
}

void startListening() {
  twai_general_config_t general = TWAI_GENERAL_CONFIG_DEFAULT(TX_PIN, RX_PIN, TWAI_MODE_LISTEN_ONLY);
  general.tx_queue_len = 0;  // sem fila, o driver recusa qualquer transmissão
  general.rx_queue_len = 64;
  twai_timing_config_t timing = TWAI_TIMING_CONFIG_50KBITS();  // ajuste à rede do seu carro (veiculos/)
  twai_filter_config_t filter = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  if (twai_driver_install(&general, &timing, &filter) != ESP_OK) halt("driver TWAI nao instalado");
  if (twai_start() != ESP_OK) halt("TWAI nao iniciou");
  sendLine("# listen-only 50 kbps");
}

void lsmSleep();
void magSleep();

// Dorme até a rede CAN acordar. Na volta, reinicia: Bluetooth e TWAI começam do zero.
void rest() {
  char line[64];
  snprintf(line, sizeof(line), "# descanso: rede parada ha %lu s", IDLE_MS / 1000);
  sendLine(line);
  Serial.flush();
  delay(200);  // dá tempo da última linha sair pelo Bluetooth
  twai_stop();
  twai_driver_uninstall();
  bt.end();
  lsmSleep();
  magSleep();
  ledsOff();  // no sono leve os pinos mantêm o nível: apagados
  // RX como entrada simples: repouso (recessivo) é nível alto; o primeiro bit dominante (baixo) acorda.
  gpio_reset_pin(RX_PIN);
  gpio_set_direction(RX_PIN, GPIO_MODE_INPUT);
  gpio_set_pull_mode(RX_PIN, GPIO_FLOATING);
  gpio_wakeup_enable(RX_PIN, GPIO_INTR_LOW_LEVEL);
  esp_sleep_enable_gpio_wakeup();
  restMark = REST_MAGIC;
  esp_light_sleep_start();
  ESP.restart();
}

// ---------- BMP180: leitura direta, pelas fórmulas do datasheet (sem biblioteca) ----------
bool bmpOk = false;
int16_t ac1, ac2, ac3, b1, b2, mc, md;
uint16_t ac4, ac5, ac6;

bool bmpRead(uint8_t reg, uint8_t *buf, uint8_t n) {
  Wire.beginTransmission(BMP_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(BMP_ADDR, n) != n) return false;
  for (uint8_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

bool bmpWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(BMP_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

void bmpBegin() {
  uint8_t id = 0, c[22];
  if (!bmpRead(0xD0, &id, 1) || id != 0x55 || !bmpRead(0xAA, c, 22)) {
    sendLine("# bmp180 ausente");
    return;
  }
  auto s16 = [&](int i) { return (int16_t)((c[i] << 8) | c[i + 1]); };
  auto u16 = [&](int i) { return (uint16_t)((c[i] << 8) | c[i + 1]); };
  ac1 = s16(0); ac2 = s16(2); ac3 = s16(4); ac4 = u16(6); ac5 = u16(8); ac6 = u16(10);
  b1 = s16(12); b2 = s16(14); mc = s16(18); md = s16(20);
  bmpOk = true;
  sendLine("# bmp180 ok");
}

// Temperatura em décimos de °C e pressão em Pa (oversampling 3, cerca de 31 ms no total).
bool bmpMeasure(int32_t &temp10, int32_t &pa) {
  const uint8_t oss = 3;
  uint8_t b[3];
  if (!bmpWrite(0xF4, 0x2E)) return false;
  delay(5);
  if (!bmpRead(0xF6, b, 2)) return false;
  int32_t ut = (b[0] << 8) | b[1];
  if (!bmpWrite(0xF4, 0x34 + (oss << 6))) return false;
  delay(26);
  if (!bmpRead(0xF6, b, 3)) return false;
  int32_t up = (((int32_t)b[0] << 16) | ((int32_t)b[1] << 8) | b[2]) >> (8 - oss);

  int32_t x1 = ((ut - (int32_t)ac6) * (int32_t)ac5) >> 15;
  int32_t x2 = ((int32_t)mc << 11) / (x1 + md);
  int32_t b5 = x1 + x2;
  temp10 = (b5 + 8) >> 4;

  int32_t b6 = b5 - 4000;
  x1 = (b2 * ((b6 * b6) >> 12)) >> 11;
  x2 = (ac2 * b6) >> 11;
  int32_t x3 = x1 + x2;
  int32_t b3 = ((((int32_t)ac1 * 4 + x3) << oss) + 2) >> 2;
  x1 = (ac3 * b6) >> 13;
  x2 = (b1 * ((b6 * b6) >> 12)) >> 16;
  x3 = ((x1 + x2) + 2) >> 2;
  uint32_t b4 = ((uint32_t)ac4 * (uint32_t)(x3 + 32768)) >> 15;
  uint32_t b7 = ((uint32_t)up - b3) * (uint32_t)(50000 >> oss);
  int32_t p = b7 < 0x80000000 ? (int32_t)((b7 * 2) / b4) : (int32_t)((b7 / b4) * 2);
  x1 = (p >> 8) * (p >> 8);
  x1 = (x1 * 3038) >> 16;
  x2 = (-7357 * p) >> 16;
  pa = p + ((x1 + x2 + 3791) >> 4);
  return true;
}

void sendAmbient() {
  int32_t t10, pa;
  if (!bmpMeasure(t10, pa)) {
    sendLine("# bmp180 sem resposta");
    return;
  }
  char line[64];
  long t = labs((long)t10);
  snprintf(line, sizeof(line), "# bmp180 temp=%s%ld.%ldC pressao=%ld.%ldhPa",
           t10 < 0 ? "-" : "", t / 10, t % 10, (long)(pa / 100), (long)((pa % 100) / 10));
  sendLine(line);
}

// ---------- LSM6DS3: acelerômetro (±4 g) e giroscópio (±250 °/s) a 104 Hz, lidos direto pelos registradores ----------
uint8_t lsmAddr = 0;
const float LSM_G_PER_LSB = 0.000122f;    // ±4 g: 0,122 mg por unidade
const float LSM_DPS_PER_LSB = 0.00875f;   // ±250 °/s: 8,75 m°/s por unidade
float imuSum[6];
float imuPeak = 0;
int imuCount = 0;

bool lsmRead(uint8_t reg, uint8_t *buf, uint8_t n) {
  Wire.beginTransmission(lsmAddr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(lsmAddr, n) != n) return false;
  for (uint8_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

bool lsmWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(lsmAddr);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

void lsmBegin() {
  for (uint8_t addr : LSM_ADDRS) {
    lsmAddr = addr;
    uint8_t id = 0;
    // WHO_AM_I: 0x69 no LSM6DS3, 0x6A no LSM6DS3TR-C (o mesmo mapa de registradores para o que usamos)
    if (!lsmRead(0x0F, &id, 1)) continue;
    if (id != 0x69 && id != 0x6A) {
      char line[48];
      snprintf(line, sizeof(line), "# lsm6ds3 id desconhecido 0x%02X em 0x%02X", id, addr);
      sendLine(line);
      continue;
    }
    // CTRL3_C: BDU (dado só troca inteiro) e endereço automático; CTRL1_XL: 104 Hz, ±4 g; CTRL2_G: 104 Hz, ±250 °/s
    if (lsmWrite(0x12, 0x44) && lsmWrite(0x10, 0x48) && lsmWrite(0x11, 0x40)) {
      char line[48];
      snprintf(line, sizeof(line), "# lsm6ds3 ok em 0x%02X (id 0x%02X)", addr, id);
      sendLine(line);
      return;
    }
  }
  lsmAddr = 0;
  sendLine("# lsm6ds3 ausente");
}

// Desliga acelerômetro e giroscópio (power-down) antes do descanso.
void lsmSleep() {
  if (!lsmAddr) return;
  lsmWrite(0x10, 0x00);
  lsmWrite(0x11, 0x00);
}

// Uma amostra: giroscópio (OUTX_L_G em diante) e acelerômetro, 12 bytes de uma vez.
void lsmSample() {
  uint8_t b[12];
  if (!lsmRead(0x22, b, 12)) return;
  float v[6];
  for (int i = 0; i < 6; i++) {
    int16_t raw = (int16_t)((b[2 * i + 1] << 8) | b[2 * i]);
    v[i] = raw * (i < 3 ? LSM_DPS_PER_LSB : LSM_G_PER_LSB);
  }
  // v[0..2] = giroscópio (°/s), v[3..5] = acelerômetro (g)
  for (int i = 0; i < 6; i++) imuSum[i] += v[i];
  float mag = sqrtf(v[3] * v[3] + v[4] * v[4] + v[5] * v[5]);
  float dev = fabsf(mag - 1.0f);
  if (dev > imuPeak) imuPeak = dev;
  imuCount++;
}

void sendImu() {
  if (imuCount == 0) {   // nenhuma leitura no intervalo: avisa no máximo a cada 5 s
    static unsigned long lastWarn = 0;
    if (millis() - lastWarn >= 5000) {
      lastWarn = millis();
      sendLine("# lsm6ds3 sem resposta");
    }
    return;
  }
  float n = imuCount;
  char line[112];
  snprintf(line, sizeof(line), "# lsm6ds3 ax=%.3f ay=%.3f az=%.3f gx=%.1f gy=%.1f gz=%.1f pico=%.2f",
           imuSum[3] / n, imuSum[4] / n, imuSum[5] / n, imuSum[0] / n, imuSum[1] / n, imuSum[2] / n, imuPeak);
  sendLine(line);
  for (float &x : imuSum) x = 0;
  imuPeak = 0;
  imuCount = 0;
}

// ---------- Magnetômetro: QMC5883L, QMC5883P ou HMC5883L, lidos direto pelos registradores ----------
enum MagChip { MAG_NENHUM, MAG_QMC5883L, MAG_QMC5883P, MAG_HMC5883L };
MagChip magChip = MAG_NENHUM;
uint8_t magAddr = 0;
float magUtPerLsb = 0;   // microtesla por unidade (1 gauss = 100 µT)
float magSum[3];
int magCount = 0;

bool i2cRead(uint8_t addr, uint8_t reg, uint8_t *buf, uint8_t n) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(addr, n) != n) return false;
  for (uint8_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

bool i2cWrite(uint8_t addr, uint8_t reg, uint8_t value) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

void magBegin() {
  uint8_t id[3] = {0, 0, 0};
  const char *name = nullptr;
  // QMC5883L: registrador 0x0D (identificação) responde 0xFF
  if (i2cRead(0x0D, 0x0D, id, 1) && id[0] == 0xFF &&
      i2cWrite(0x0D, 0x0B, 0x01) &&                // período de SET/RESET recomendado pela folha de dados
      i2cWrite(0x0D, 0x09, 0x1D)) {                // contínuo, 50 Hz, ±8 G, 512 amostras por média
    magChip = MAG_QMC5883L; magAddr = 0x0D; magUtPerLsb = 100.0f / 3000.0f; name = "qmc5883l";
  } else if (i2cRead(0x2C, 0x00, id, 1) && id[0] == 0x80 &&
      // QMC5883P: identificação 0x80 no registrador 0x00
      i2cWrite(0x2C, 0x29, 0x06) &&                // sinal dos eixos, como no exemplo da folha de dados
      i2cWrite(0x2C, 0x0B, 0x08) &&                // SET/RESET ligado, ±8 G
      i2cWrite(0x2C, 0x0A, 0xCD)) {                // modo normal, 200 Hz
    magChip = MAG_QMC5883P; magAddr = 0x2C; magUtPerLsb = 100.0f / 3750.0f; name = "qmc5883p";
  } else if (i2cRead(0x1E, 0x0A, id, 3) && id[0] == 'H' && id[1] == '4' && id[2] == '3' &&
      // HMC5883L: identificação "H43" nos registradores 0x0A a 0x0C
      i2cWrite(0x1E, 0x00, 0x70) &&                // média de 8, 15 Hz
      i2cWrite(0x1E, 0x01, 0x20) &&                // ±1,3 G: 1090 unidades por gauss
      i2cWrite(0x1E, 0x02, 0x00)) {                // contínuo
    magChip = MAG_HMC5883L; magAddr = 0x1E; magUtPerLsb = 100.0f / 1090.0f; name = "hmc5883l";
  }
  if (!name) {
    sendLine("# mag ausente");
    return;
  }
  char line[48];
  snprintf(line, sizeof(line), "# mag ok %s em 0x%02X", name, magAddr);
  sendLine(line);
}

// Desliga o magnetômetro antes do descanso.
void magSleep() {
  if (magChip == MAG_QMC5883L) i2cWrite(magAddr, 0x09, 0x00);
  else if (magChip == MAG_QMC5883P) i2cWrite(magAddr, 0x0A, 0x00);
  else if (magChip == MAG_HMC5883L) i2cWrite(magAddr, 0x02, 0x03);
}

void magSample() {
  uint8_t b[6];
  int16_t x, y, z;
  if (magChip == MAG_QMC5883L) {
    if (!i2cRead(magAddr, 0x00, b, 6)) return;      // X, Y, Z, byte baixo primeiro
    x = (int16_t)(b[1] << 8 | b[0]); y = (int16_t)(b[3] << 8 | b[2]); z = (int16_t)(b[5] << 8 | b[4]);
  } else if (magChip == MAG_QMC5883P) {
    if (!i2cRead(magAddr, 0x01, b, 6)) return;      // X, Y, Z, byte baixo primeiro
    x = (int16_t)(b[1] << 8 | b[0]); y = (int16_t)(b[3] << 8 | b[2]); z = (int16_t)(b[5] << 8 | b[4]);
  } else {
    if (!i2cRead(magAddr, 0x03, b, 6)) return;      // X, Z, Y, byte alto primeiro
    x = (int16_t)(b[0] << 8 | b[1]); z = (int16_t)(b[2] << 8 | b[3]); y = (int16_t)(b[4] << 8 | b[5]);
    if (x == -4096 || y == -4096 || z == -4096) return;   // estouro da faixa
  }
  magSum[0] += x * magUtPerLsb;
  magSum[1] += y * magUtPerLsb;
  magSum[2] += z * magUtPerLsb;
  magCount++;
}

void sendMag() {
  if (magCount == 0) {
    static unsigned long lastWarn = 0;
    if (millis() - lastWarn >= 5000) {
      lastWarn = millis();
      sendLine("# mag sem resposta");
    }
    return;
  }
  char line[80];
  snprintf(line, sizeof(line), "# mag x=%.1f y=%.1f z=%.1f", magSum[0] / magCount, magSum[1] / magCount, magSum[2] / magCount);
  sendLine(line);
  magSum[0] = magSum[1] = magSum[2] = 0;
  magCount = 0;
}

void sendFrame(const twai_message_t &m) {
  bool ext = m.flags & TWAI_MSG_FLAG_EXTD;
  bool rtr = m.flags & TWAI_MSG_FLAG_RTR;
  uint8_t len = m.data_length_code > 8 ? 8 : m.data_length_code;
  char line[32];
  int n = ext ? snprintf(line, sizeof(line), "%c%08lX%X", rtr ? 'R' : 'T', (unsigned long)m.identifier, len)
              : snprintf(line, sizeof(line), "%c%03lX%X", rtr ? 'r' : 't', (unsigned long)m.identifier, len);
  if (!rtr) for (uint8_t i = 0; i < len; i++) n += snprintf(line + n, sizeof(line) - n, "%02X", m.data[i]);
  sendLine(line);
}

void setup() {
  bool woke = restMark == REST_MAGIC;
  restMark = 0;
  Serial.begin(500000);
  ledsInit();
  if (!bt.begin(BT_NAME)) Serial.println("# ERRO Bluetooth nao iniciou; seguindo so pela USB");
  sendLine("# esp32-can-listen 1.5");
  if (woke) sendLine("# acordou: atividade na rede CAN");
  Wire.begin(I2C_SDA, I2C_SCL, 100000);   // BMP180, LSM6DS3 e magnetômetro dividem o mesmo I2C
  bmpBegin();
  lsmBegin();
  magBegin();
  startListening();
  lastFrame = millis();
}

void loop() {
  twai_message_t message;
  while (twai_receive(&message, pdMS_TO_TICKS(10)) == ESP_OK) {
    sendFrame(message);
    frames++;
    lastFrame = millis();
  }

  unsigned long now = millis();
  leds(!bt.hasClient() ? SEM_APP : now - lastFrame < CAPTURA_MS ? CAPTURANDO : SEM_REDE, now);
  // Só dorme com a linha em repouso; se o RX estiver preso em nível baixo, acordaria na hora.
  if (REST_ENABLED && now - lastFrame >= IDLE_MS && gpio_get_level(RX_PIN) == 1) rest();

  if (lsmAddr && now - lastImuSample >= IMU_SAMPLE_MS) {
    lastImuSample = now;
    lsmSample();
  }
  if (lsmAddr && now - lastImu >= IMU_MS) {
    lastImu = now;
    sendImu();
  }

  if (magChip != MAG_NENHUM && now - lastMagSample >= MAG_SAMPLE_MS) {
    lastMagSample = now;
    magSample();
  }
  if (magChip != MAG_NENHUM && now - lastMag >= MAG_MS) {
    lastMag = now;
    sendMag();
  }

  if (bmpOk && now - lastAmb >= AMB_MS) {
    lastAmb = now;
    sendAmbient();
  }

  if (now - lastStats >= STATS_MS) {
    lastStats = now;
    twai_status_info_t status = {};
    twai_get_status_info(&status);
    char line[96];
    snprintf(line, sizeof(line), "# stats quadros=%lu perdidos=%lu erros=%lu",
             frames, (unsigned long)(status.rx_missed_count + status.rx_overrun_count), (unsigned long)status.bus_error_count);
    sendLine(line);
  }
}
