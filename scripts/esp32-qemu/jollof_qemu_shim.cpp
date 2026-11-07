// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Essai 4.4 (ESP32 sous QEMU) : cale ajoutée au croquis, et seulement pour l'émulateur. Le modèle GPIO du QEMU
// d'Espressif ne garde rien (écritures ignorées, lectures à 0) : sans cale, digitalRead() rend toujours LOW et
// analogRead() 0. La cale remplace les fonctions « faibles » du cœur arduino-esp32 (digitalRead, analogRead,
// attachInterrupt, pinMode, digitalWrite) et parle à l'hôte par l'UART1, que le programme n'utilise pas :
//   hôte → carte : 'I' + 5 octets (niveaux des GPIO 0 à 39, petit-boutiste) ; 'A' + broche + 2 octets (ADC 0..4095)
//   carte → hôte : trames de 10 octets [type, broche, valeur u32, temps virtuel µs u32] ;
//                  types 'J' (cale prête), 'M' (pinMode), 'W' (digitalWrite).
// Les registres de l'UART1 sont lus directement : QEMU remplit sa FIFO de réception sans configuration préalable.
#include <Arduino.h>
#include "esp_timer.h"

extern "C" {
void __pinMode(uint8_t pin, uint8_t mode);
void __digitalWrite(uint8_t pin, uint8_t val);
}

#define JQ_FIFO (*(volatile uint32_t *)0x3FF50000)   // UART1 : FIFO (écriture : émission, lecture : réception)
#define JQ_STATUS (*(volatile uint32_t *)0x3FF5001C) // UART1 : bits 0-7 octets reçus, 16-23 octets en attente d'envoi

static volatile uint64_t jqIn = 0;       // niveaux imposés par le montage (bit n = GPIO n)
static volatile uint64_t jqOutMask = 0;  // broches en sortie
static volatile uint64_t jqOut = 0;      // niveau des sorties
static volatile uint16_t jqAdc[40];      // ADC brut poussé par l'hôte
static voidFuncPtr jqIsr[40];
static uint8_t jqIsrMode[40];
static uint8_t jqBuf[8], jqLen = 0;
static esp_timer_handle_t jqTimer = nullptr;
static portMUX_TYPE jqLock = portMUX_INITIALIZER_UNLOCKED;

static void jqSend(char type, uint8_t pin, uint32_t v) {
  uint32_t t = (uint32_t)esp_timer_get_time();
  uint8_t f[10] = {(uint8_t)type, pin, (uint8_t)v, (uint8_t)(v >> 8), (uint8_t)(v >> 16), (uint8_t)(v >> 24),
                   (uint8_t)t, (uint8_t)(t >> 8), (uint8_t)(t >> 16), (uint8_t)(t >> 24)};
  portENTER_CRITICAL_SAFE(&jqLock);
  if (((JQ_STATUS >> 16) & 0xff) < 100) for (uint8_t b : f) JQ_FIFO = b; // hôte absent ou en retard : on jette
  portEXIT_CRITICAL_SAFE(&jqLock);
}

// Toutes les millisecondes (tâche esp_timer) : trames de l'hôte, et fronts transmis aux fonctions attachées.
static void jqPoll(void *) {
  while (JQ_STATUS & 0xff) {
    uint8_t b = (uint8_t)JQ_FIFO;
    if (jqLen == 0 && b != 'I' && b != 'A') continue; // resynchronisation sur un début de trame
    jqBuf[jqLen++] = b;
    if (jqBuf[0] == 'I' && jqLen == 6) {
      uint64_t v = 0;
      for (int i = 5; i >= 1; i--) v = (v << 8) | jqBuf[i];
      uint64_t changed = jqIn ^ v;
      jqIn = v;
      jqLen = 0;
      for (int p = 0; p < 40; p++) {
        if (!((changed >> p) & 1) || !jqIsr[p]) continue;
        bool up = (v >> p) & 1;
        uint8_t m = jqIsrMode[p];
        if (m == CHANGE || (m == RISING && up) || (m == FALLING && !up)) jqIsr[p]();
      }
    } else if (jqBuf[0] == 'A' && jqLen == 4) {
      if (jqBuf[1] < 40) jqAdc[jqBuf[1]] = jqBuf[2] | (jqBuf[3] << 8);
      jqLen = 0;
    }
  }
}

// Chiens de garde matériels des groupes de minuteries 0 et 1 (TWDT et chien de garde d'interruption) coupés :
// sous QEMU, le temps virtuel suit l'horloge de l'hôte, et un à-coup de l'émulateur suffit à les déclencher
// (remises à zéro TG1WDT puis TG0WDT observées pendant l'essai, absentes avec -icount).
static void jqNoWatchdog() {
  static const uint32_t bases[] = {0x3FF5F000, 0x3FF60000};
  for (uint32_t base : bases) {
    *(volatile uint32_t *)(base + 0x64) = 0x50D83AA1; // WDTWPROTECT : déverrouillage
    *(volatile uint32_t *)(base + 0x48) = 0;          // WDTCONFIG0 : arrêt
    *(volatile uint32_t *)(base + 0x64) = 0;
  }
}
__attribute__((constructor)) static void jqEarly() { jqNoWatchdog(); }

static void jqStart() {
  if (jqTimer) return;
  jqNoWatchdog(); // de nouveau : l'initialisation d'Arduino a pu les remettre en marche
  esp_timer_create_args_t a = {};
  a.callback = jqPoll;
  a.name = "jollof";
  if (esp_timer_create(&a, &jqTimer) == ESP_OK) esp_timer_start_periodic(jqTimer, 1000);
  jqSend('J', 0, 1);
}

// Appelée par initArduino() juste avant setup() (fonction « faible » du cœur, que la carte ESP32 DevKit ne
// définit pas) : la cale démarre même si le programme n'appelle aucune fonction de broche.
extern "C" void initVariant() { jqStart(); }

extern "C" void pinMode(uint8_t pin, uint8_t mode) {
  jqStart();
  __pinMode(pin, mode);
  if (pin < 40) {
    // OUTPUT vaut 0x03 et INPUT 0x01 : c'est le bit 1 qui distingue une sortie (OUTPUT, OUTPUT_OPEN_DRAIN).
    if (mode & 0x02) jqOutMask |= 1ULL << pin; else jqOutMask &= ~(1ULL << pin);
  }
  jqSend('M', pin, mode);
}

extern "C" void digitalWrite(uint8_t pin, uint8_t val) {
  __digitalWrite(pin, val);
  if (pin < 40) {
    if (val) jqOut |= 1ULL << pin; else jqOut &= ~(1ULL << pin);
  }
  jqSend('W', pin, val);
}

extern "C" int digitalRead(uint8_t pin) {
  jqStart();
  if (pin >= 40) return 0;
  return ((jqOutMask >> pin) & 1) ? (jqOut >> pin) & 1 : (jqIn >> pin) & 1;
}

extern "C" uint16_t analogRead(uint8_t pin) {
  jqStart();
  return pin < 40 ? jqAdc[pin] : 0;
}

extern "C" void attachInterrupt(uint8_t pin, voidFuncPtr fn, int mode) {
  jqStart();
  if (pin < 40) { jqIsrMode[pin] = mode; jqIsr[pin] = fn; }
}

extern "C" void detachInterrupt(uint8_t pin) {
  if (pin < 40) jqIsr[pin] = nullptr;
}
