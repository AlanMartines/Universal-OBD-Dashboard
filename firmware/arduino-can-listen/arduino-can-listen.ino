/*
 * Escuta passiva da rede CAN com Arduino Uno + módulo MCP2515.
 *
 * O MCP2515 fica em modo Listen-Only: o próprio chip não envia nada à rede,
 * nem quadros, nem ACK, nem quadros de erro. Este programa nunca chama
 * setNormalMode() nem sendMessage(), e para se o modo não for confirmado.
 *
 * Saída pela USB a 500000 baud, uma linha por quadro no formato slcan:
 *   t1238AABBCCDDEEFF0011   quadro padrão: t + ID (3 hex) + tamanho + dados
 *   T1234567820011          quadro estendido: T + ID (8 hex) + tamanho + dados
 *   r1230 / R123456780      pedido remoto (RTR) recebido
 * Linhas começadas por '#' são mensagens de estado.
 *
 * Biblioteca: autowp/arduino-mcp2515 (Gerenciador de Bibliotecas: "autowp-mcp2515").
 * Guia de ligação e uso: docs/can-escuta.md.
 */
#include <SPI.h>
#include <mcp2515.h>

// Cristal do módulo (gravado no componente metálico ao lado do chip): MCP_8MHZ ou MCP_16MHZ.
const CAN_CLOCK CRYSTAL = MCP_8MHZ;
const uint8_t CS_PIN = 10;

// Velocidades tentadas em ordem. A rede da carroceria do Uno é de 50 kbit/s, então ela vem primeiro.
// Com FIXED_RATE em 1, só a primeira é usada, sem busca.
#define FIXED_RATE 0
const CAN_SPEED RATES[] = {CAN_50KBPS, CAN_33KBPS, CAN_100KBPS, CAN_125KBPS, CAN_250KBPS, CAN_500KBPS};
const char *const RATE_NAMES[] = {"50", "33.3", "100", "125", "250", "500"};
const uint8_t RATE_COUNT = sizeof(RATES) / sizeof(RATES[0]);

// Tempo sem nenhum quadro antes de tentar a próxima velocidade.
const unsigned long PROBE_MS = 3000;
// Intervalo das estatísticas.
const unsigned long STATS_MS = 10000;

MCP2515 mcp2515(CS_PIN);
uint8_t rateIndex = 0;
bool locked = false;
unsigned long rateSince = 0;
unsigned long lastStats = 0;
unsigned long frames = 0;
unsigned long overflows = 0;

void halt(const char *why) {
  Serial.print(F("# ERRO "));
  Serial.println(why);
  Serial.println(F("# parado: nada foi enviado a rede"));
  for (;;) {}
}

// reset() deixa o chip em modo de configuração, que também não transmite.
void startListening(uint8_t index) {
  if (mcp2515.reset() != MCP2515::ERROR_OK) halt("MCP2515 nao respondeu (SPI)");
  if (mcp2515.setBitrate(RATES[index], CRYSTAL) != MCP2515::ERROR_OK) halt("velocidade nao suportada com este cristal");
  // setListenOnlyMode() confere o modo no registrador CANSTAT e devolve erro se o chip não entrou nele.
  if (mcp2515.setListenOnlyMode() != MCP2515::ERROR_OK) halt("modo listen-only nao confirmado");
  rateIndex = index;
  rateSince = millis();
  Serial.print(F("# listen-only "));
  Serial.print(RATE_NAMES[index]);
  Serial.println(F(" kbps"));
}

void printHex(uint32_t value, uint8_t digits) {
  while (digits--) Serial.print("0123456789ABCDEF"[(value >> (4 * digits)) & 0xF]);
}

void printFrame(const struct can_frame &f) {
  bool ext = f.can_id & CAN_EFF_FLAG;
  bool rtr = f.can_id & CAN_RTR_FLAG;
  Serial.print(rtr ? (ext ? 'R' : 'r') : (ext ? 'T' : 't'));
  printHex(f.can_id & (ext ? CAN_EFF_MASK : CAN_SFF_MASK), ext ? 8 : 3);
  uint8_t len = f.can_dlc > 8 ? 8 : f.can_dlc;
  printHex(len, 1);
  if (!rtr) for (uint8_t i = 0; i < len; i++) printHex(f.data[i], 2);
  Serial.println();
}

void setup() {
  Serial.begin(500000);
  Serial.println(F("# arduino-can-listen 1.0"));
  startListening(0);
}

void loop() {
  struct can_frame frame;
  while (mcp2515.readMessage(&frame) == MCP2515::ERROR_OK) {
    printFrame(frame);
    frames++;
    if (!locked) {
      locked = true;
      Serial.print(F("# quadros recebidos a "));
      Serial.print(RATE_NAMES[rateIndex]);
      Serial.println(F(" kbps: velocidade fixada"));
    }
  }

  uint8_t flags = mcp2515.getErrorFlags();
  if (flags & (MCP2515::EFLG_RX0OVR | MCP2515::EFLG_RX1OVR)) {
    overflows++;
    mcp2515.clearRXnOVRFlags();
  }

  unsigned long now = millis();
  if (!locked && !FIXED_RATE && now - rateSince >= PROBE_MS) {
    Serial.print(F("# nada a "));
    Serial.print(RATE_NAMES[rateIndex]);
    Serial.println(F(" kbps"));
    startListening((rateIndex + 1) % RATE_COUNT);
  }

  if (now - lastStats >= STATS_MS) {
    lastStats = now;
    Serial.print(F("# stats quadros="));
    Serial.print(frames);
    Serial.print(F(" perdidos="));
    Serial.print(overflows);
    Serial.print(F(" eflg=0x"));
    printHex(flags, 2);
    Serial.println();
  }
}
