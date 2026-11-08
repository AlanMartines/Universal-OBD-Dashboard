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
 * Placa: "ESP32 Dev Module", no pacote esp32 da Espressif. Guia: docs/can-escuta.md.
 */
#include <BluetoothSerial.h>
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

BluetoothSerial bt;
unsigned long lastStats = 0;
unsigned long lastFrame = 0;
unsigned long frames = 0;

// Manda a mesma linha para a USB e para quem estiver conectado no Bluetooth.
void sendLine(const char *line) {
  Serial.println(line);
  if (bt.hasClient()) bt.println(line);
}

void halt(const char *why) {
  char line[80];
  snprintf(line, sizeof(line), "# ERRO %s", why);
  sendLine(line);
  sendLine("# parado: nada foi enviado a rede");
  if (!REST_ENABLED) for (;;) delay(1000);
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
  if (!bt.begin(BT_NAME)) Serial.println("# ERRO Bluetooth nao iniciou; seguindo so pela USB");
  sendLine("# esp32-can-listen 1.1");
  if (woke) sendLine("# acordou: atividade na rede CAN");
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
  // Só dorme com a linha em repouso; se o RX estiver preso em nível baixo, acordaria na hora.
  if (REST_ENABLED && now - lastFrame >= IDLE_MS && gpio_get_level(RX_PIN) == 1) rest();

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
