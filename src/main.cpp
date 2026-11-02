#include <Arduino.h>

const int PIN_CLK  = 18;
const int PIN_DATA = 19;
const uint32_t PAUSA_US = 2000;

volatile uint32_t pulsos = 0, ultimo = 0, bits = 0, trama = 0;
volatile uint8_t  nbits = 0, tramaBits = 0;
volatile bool lista = false;

void IRAM_ATTR onClk() {
  uint32_t ahora = micros();
  if (ahora - ultimo > PAUSA_US) {
    if (nbits > 0) { trama = bits; tramaBits = nbits; lista = true; }
    bits = 0; nbits = 0;
  }
  ultimo = ahora;
  if (nbits < 32) {
    if (!digitalRead(PIN_DATA)) bits |= (1UL << nbits);
    nbits++;
  }
  pulsos++;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_CLK, INPUT);
  pinMode(PIN_DATA, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_CLK), onClk, RISING);
  Serial.println("Esperando pulsos del vernier...");
}

void loop() {
  static uint32_t t = 0;
  if (lista) {
    noInterrupts();
    uint32_t b = trama; uint8_t n = tramaBits; lista = false;
    interrupts();
    Serial.printf("%2u bits: ", n);
    for (int i = 0; i < n; i++) Serial.print((b >> i) & 1);
    if (n == 24) {
      // bit 0 siempre 1, bits 1-20 = valor, bit 21 = signo negativo
      int32_t valor = (b >> 1) & 0xFFFFF;
      if (b & (1UL << 21)) valor = -valor;
      Serial.printf("  ->  %.2f mm", valor / 100.0);
    }
    Serial.println();
  }
  if (millis() - t > 2000) {
    t = millis();
    Serial.printf("pulsos totales: %lu\n", pulsos);
  }
}
