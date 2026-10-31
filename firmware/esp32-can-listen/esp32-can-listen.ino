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
 * Placa: "ESP32 Dev Module", no pacote esp32 da Espressif. Guia: docs/can-escuta.md.
 */
#include <BluetoothSerial.h>
#include "driver/twai.h"

const gpio_num_t RX_PIN = GPIO_NUM_21;  // recebe do transceptor; TJA1050 passa por divisor de tensão
const gpio_num_t TX_PIN = GPIO_NUM_22;  // exigido pelo driver; deixar sem ligação
const char *const BT_NAME = "OBD-CAN-Escuta";

// Intervalo das estatísticas.
const unsigned long STATS_MS = 10000;

BluetoothSerial bt;
unsigned long lastStats = 0;
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
  for (;;) delay(1000);
}

void startListening() {
  twai_general_config_t general = TWAI_GENERAL_CONFIG_DEFAULT(TX_PIN, RX_PIN, TWAI_MODE_LISTEN_ONLY);
  general.tx_queue_len = 0;  // sem fila, o driver recusa qualquer transmissão
  general.rx_queue_len = 64;
  twai_timing_config_t timing = TWAI_TIMING_CONFIG_50KBITS();  // rede da carroceria do Uno
  twai_filter_config_t filter = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  if (twai_driver_install(&general, &timing, &filter) != ESP_OK) halt("driver TWAI nao instalado");
  if (twai_start() != ESP_OK) halt("TWAI nao iniciou");
  sendLine("# listen-only 50 kbps");
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
  Serial.begin(500000);
  if (!bt.begin(BT_NAME)) Serial.println("# ERRO Bluetooth nao iniciou; seguindo so pela USB");
  sendLine("# esp32-can-listen 1.0");
  startListening();
}

void loop() {
  twai_message_t message;
  while (twai_receive(&message, pdMS_TO_TICKS(10)) == ESP_OK) {
    sendFrame(message);
    frames++;
  }

  unsigned long now = millis();
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
