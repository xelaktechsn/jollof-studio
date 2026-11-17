// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
//
// Additional permission under GNU AGPL version 3 section 7:
// As a special exception, the copyright holder of this file gives you permission to compile this file and to link
// the resulting object code with any other program (in particular an Arduino sketch, its libraries and the ESP32
// core), and to copy, modify and convey the resulting combined program under terms of your choice, without this
// file by itself causing the combined program to be covered by the GNU Affero General Public License. This
// exception does not change the license of this file itself. If you modify this file, you may extend this
// exception to your version of the file, but you are not obligated to do so.
// (En résumé : compiler ce fichier dans un programme ne met pas ce programme sous AGPL.)
//
// Mode fidèle de l'ESP32 (Jollof Studio) : cale ajoutée au croquis, pour l'émulateur seulement (QEMU d'Espressif).
// QEMU fait tourner le vrai programme mais n'émule ni les modules du montage ni les entrées des broches (son modèle
// GPIO ne garde rien : digitalRead() rendrait toujours LOW). La cale remplace, à la frontière du cœur arduino-esp32
// et des bibliothèques, ce qui touche au montage, et le fait passer par l'UART1 (que le programme n'utilise pas) vers
// l'application, où répondent les mêmes modèles de modules que pour l'Uno et le Pico (src/emu/esp32-bridge.js) :
//   - broches : pinMode, digitalWrite, digitalRead, analogRead, attachInterrupt (fonctions « faibles » du cœur) ;
//   - bus I2C (Wire), SPI, RMT (NeoPixel), ports série Serial1 et Serial2, 1-Wire (bibliothèque OneWire) : fonctions
//     remplacées à l'édition des liens (-Wl,--wrap=…, liste dans src/emu/esp32-wraps.js) ; les autres fonctions de
//     ces pilotes restent celles du cœur.
// Temps : le temps « des modules » est celui de la carte (esp_timer) moins ce que l'émulation y ajoute sur les broches
// reliées (jqStall : envoi des trames, attente d'une réponse de l'application, lenteur de QEMU entre deux appels, voir
// jqBrCall) : une lecture qui fait l'aller-retour ne compte pas dans la largeur d'une impulsion, ni dans l'instant
// d'une réponse de capteur (DHT, HC-SR04…), comme si le module avait répondu sur le fil. Ce décalage est remis à zéro
// dès que la carte ne touche plus aux broches reliées pendant 20 ms, ou quand le programme se cale sur micros().
// Protocole (UART1), carte → application :
//   trames de 10 octets [type, broche, valeur u32, temps de la carte en µs u32] : 'J' (cale prête), 'M' (pinMode),
//   'T' (battement, toutes les 10 ms ; valeur : décalage jqStall en µs) ;
//   trames variables ['V', op, longueur u16, temps des modules u32, données] : op 'q' (requête, l'application
//   répond), 'p' (envoi sans réponse) ; le premier octet des données dit quoi (voir jqHandle… dans esp32-bridge.js).
// Application → carte : 'I' + 7 octets (niveaux des GPIO 0 à 55), 'A' + broche + 2 octets (ADC brut 0 à 4095),
//   ['R', op, longueur u16, données] : 'r' réponse à la requête en cours, 'B' broches reliées aux modules (masque de 7 octets),
//   'P' changements de niveau programmés [broche, niveau, instant u32]…, 'U' octets reçus par Serial1/Serial2,
//   'N' adresse I2C qui n'acquitte plus.
#include <Arduino.h>
#include "esp_timer.h"
#include "esp_cpu.h"
#include "esp32-hal-i2c.h"
#include "esp32-hal-spi.h"
#include "esp32-hal-rmt.h"
#include "esp32-hal-uart.h"
#if __has_include("soc/interrupt_core0_reg.h")
#include "soc/interrupt_core0_reg.h"
#endif

extern "C" {
void __pinMode(uint8_t pin, uint8_t mode);
void __digitalWrite(uint8_t pin, uint8_t val);
}

#if CONFIG_IDF_TARGET_ESP32
#define JQ_UART1 0x3FF50000
#define JQ_RXCNT(s) ((s) & 0xff)
#define JQ_TXCNT(s) (((s) >> 16) & 0xff)
static const uint32_t jqTimg[] = {0x3FF5F000, 0x3FF60000};
#define JQ_WDT_CFG 0x48
#define JQ_WDT_PROT 0x64
#define JQ_PINS 40
#else
#define JQ_UART1 0x60010000
#define JQ_RXCNT(s) ((s) & 0x3ff)
#define JQ_TXCNT(s) (((s) >> 16) & 0x3ff)
#if CONFIG_IDF_TARGET_ESP32S3
static const uint32_t jqTimg[] = {0x6001F000, 0x60020000};
#define JQ_PINS 49
#else
static const uint32_t jqTimg[] = {0x6001F000, 0x60020000};
#define JQ_PINS 22
#endif
#define JQ_WDT_CFG 0x48
#define JQ_WDT_PROT 0x64
#endif
#define JQ_FIFO (*(volatile uint32_t *)(JQ_UART1 + 0x00))   // FIFO (écriture : émission, lecture : réception)
#define JQ_STATUS (*(volatile uint32_t *)(JQ_UART1 + 0x1C)) // octets reçus, octets à envoyer
#define JQ_BIT(p) (1ULL << (p))

static volatile uint64_t jqIn = 0;       // niveaux imposés par le montage (bit n = GPIO n)
static volatile uint64_t jqOutMask = 0;  // broches en sortie
static volatile uint64_t jqOut = 0;      // niveau des sorties
static volatile uint16_t jqAdc[JQ_PINS];
static void (*jqIsr[JQ_PINS])(void *);
static void *jqArg[JQ_PINS];
static uint8_t jqIsrMode[JQ_PINS];
static uint64_t jqIsrLevel = 0;          // niveaux déjà vus par les fonctions attachées
static volatile TaskHandle_t jqIsrTask = nullptr; // tâche de la cale pendant qu'elle appelle une fonction attachée
/** Contexte d'interruption : vraie interruption, ou fonction attachée appelée par la cale (dans sa tâche). */
static inline bool jqIsr_() { return xPortInIsrContext() || (jqIsrTask && jqIsrTask == xTaskGetCurrentTaskHandle()); }
static uint8_t jqBeat = 0;
static volatile bool jqGotInputs = false, jqDead = false;
static esp_timer_handle_t jqTimer = nullptr;
static portMUX_TYPE jqLock = portMUX_INITIALIZER_UNLOCKED;

/* ---------- Broches reliées aux modules (application : 'B') ---------- */
static volatile uint64_t jqBr = 0;       // broches reliées à un module : leurs changements partent dans l'ordre
static volatile uint64_t jqBrIn = 0;     // niveau de ces broches quand la carte les lit
static volatile bool jqStale = false;    // la carte a changé une broche reliée depuis la dernière réponse
static volatile bool jqResyncPending = false; // broches reliées reçues : leur mode et leur niveau sont à renvoyer
static uint8_t jqMode[JQ_PINS];          // dernier pinMode() de chaque broche (0 : jamais appelé)
struct JqEv { uint32_t t; uint8_t pin, level; };
#define JQ_EVS 512
static JqEv jqEv[JQ_EVS];                // changements de niveau programmés (temps des modules), triés
static volatile uint16_t jqEvN = 0, jqEvHead = 0;

/* ---------- Temps des modules ---------- */
static volatile int64_t jqStall = 0, jqLastAct = 0;
static volatile int64_t jqHold = 0;      // pendant une attente : heure des modules à ne pas dépasser (battement)
static inline uint32_t jqDev() { return (uint32_t)(esp_timer_get_time() - jqStall); }
// QEMU exécute le programme bien plus lentement qu'un vrai ESP32 dès qu'il touche aux registres (un appel à
// esp_timer_get_time() ou à pinMode() y coûte des dizaines de microsecondes, une interruption de l'horloge davantage) :
// juste avant ou après un changement d'une broche reliée, le temps des modules ne compte que les attentes demandées
// (delayMicroseconds) plus 5 µs au plus (impulsion TRIG d'un HC-SR04, l'écho ne doit pas commencer avant que pulseIn()
// regarde), et interruptions coupées, 1 µs par appel (boucles de lecture d'un DHT, d'un HX711), comme sur la vraie
// carte. Entre deux lectures, le temps réel compte (boucles mesurées avec micros()). Au-delà de 3 ms sans broche
// reliée, le programme fait autre chose : rien n'est retranché.
static int64_t jqLastBr = 0, jqDelaySince = 0;
static bool jqLastEvent = false;
static volatile bool jqTimeAsked = false; // le programme a lu micros() ou millis() depuis : il se cale sur le temps réel
static inline bool jqMasked() {
#if defined(__XTENSA__)
  uint32_t ps;
  __asm__ __volatile__("rsr.ps %0" : "=a"(ps));
  return (ps & 0xF) >= 3;
#else
  // RISC-V (ESP32-C3) : FreeRTOS coupe les interruptions par le seuil du contrôleur (RVHAL_EXCM_LEVEL), pas par MIE.
  uint32_t m;
  __asm__ __volatile__("csrr %0, mstatus" : "=r"(m));
  if (!(m & 8)) return true;
#ifdef INTERRUPT_CORE0_CPU_INT_THRESH_REG
  return REG_READ(INTERRUPT_CORE0_CPU_INT_THRESH_REG) >= 4;
#else
  return false;
#endif
#endif
}
static void jqBrCall(bool event) {
  if (jqIsr_()) return;
  int64_t real = esp_timer_get_time(), dev = real - jqStall;
  bool masked = jqMasked();
  int64_t gap = jqLastBr ? dev - jqLastBr - jqDelaySince : 0;
  // Le programme a attendu en lisant micros()/millis() (AccelStepper : un pas toutes les millisecondes) : les modules
  // reprennent le temps réel, ce que le programme a mesuré. Pas pendant une suite programmée en cours (écho d'un
  // HC-SR04 mesuré avec micros()) : elle se joue sans à-coup.
  if (jqTimeAsked && !masked && gap > 500 && jqEvHead == jqEvN) jqStall = 0;
  else if (jqLastBr) {
    int64_t cap = masked ? 1 : (event || jqLastEvent) ? 5 : -1;
    if (cap >= 0 && gap > cap && gap < 3000) jqStall += gap - cap;
  }
  jqLastBr = real - jqStall; jqDelaySince = 0; jqLastAct = real; jqLastEvent = event; jqTimeAsked = false;
}

/* ---------- Verrous (sans FreeRTOS : utilisables interruptions coupées) ---------- */
static volatile uint8_t jqTxBusy = 0, jqRxBusy = 0;
static bool jqTry(volatile uint8_t *f) {
  bool ok = false;
  portENTER_CRITICAL_SAFE(&jqLock);
  if (!*f) { *f = 1; ok = true; }
  portEXIT_CRITICAL_SAFE(&jqLock);
  return ok;
}
static void jqTake(volatile uint8_t *f) { while (!jqTry(f)) {} }
static inline void jqGive(volatile uint8_t *f) { *f = 0; }

// Place libre dans la FIFO d'émission, relue seulement quand elle semble pleine (chaque accès à un registre coûte
// cher dans QEMU).
static uint32_t jqRoom = 0;
static inline void jqPut(uint8_t b) {
  while (!jqRoom) { uint32_t n = JQ_TXCNT(JQ_STATUS); jqRoom = n < 120 ? 120 - n : 0; }
  JQ_FIFO = b;
  jqRoom--;
}
// Ce que coûte l'envoi d'une trame (accès aux registres de l'UART, lents dans QEMU) ne compte pas dans le temps des
// modules : pour eux, la carte n'a rien fait pendant ce temps.
static inline void jqOverhead(int64_t t0) { if (!xPortInIsrContext()) jqStall += esp_timer_get_time() - t0; }
static void jqSend(char type, uint8_t pin, uint32_t v, bool pinTraffic = false) {
  uint32_t t = (uint32_t)esp_timer_get_time();
  uint8_t f[10] = {(uint8_t)type, pin, (uint8_t)v, (uint8_t)(v >> 8), (uint8_t)(v >> 16), (uint8_t)(v >> 24),
                   (uint8_t)t, (uint8_t)(t >> 8), (uint8_t)(t >> 16), (uint8_t)(t >> 24)};
  if (type == 'T') { // battement : jamais d'attente (tâche esp_timer) ; application en retard : on le saute
    if (!jqTry(&jqTxBusy)) return;
    if (JQ_TXCNT(JQ_STATUS) < 100) for (uint8_t b : f) JQ_FIFO = b;
    jqGive(&jqTxBusy);
    return;
  }
  int64_t t0 = esp_timer_get_time();
  jqTake(&jqTxBusy);
  jqRoom = 0;
  for (uint8_t b : f) jqPut(b);
  jqGive(&jqTxBusy);
  if (pinTraffic) jqOverhead(t0);
}
/**
 * Trame variable : en-tête (heure des modules : at, sinon maintenant), puis jusqu'à deux morceaux de données.
 * pin : trame d'une broche reliée (son envoi ne compte pas pour les modules) ; les bus (I2C, SPI, séries) gardent
 * le temps réel, que leurs modules mesurent comme le programme (cycle d'écriture d'une EEPROM, conversion d'un capteur).
 */
static void jqFrameAt(char op, int64_t at, const uint8_t *a, size_t na, const uint8_t *b = nullptr, size_t nb = 0, bool pin = false) {
  size_t n = na + nb;
  int64_t t0 = esp_timer_get_time();
  uint32_t t = (uint32_t)(at >= 0 ? at : t0 - jqStall);
  jqTake(&jqTxBusy);
  jqRoom = 0;
  uint8_t h[8] = {'V', (uint8_t)op, (uint8_t)n, (uint8_t)(n >> 8), (uint8_t)t, (uint8_t)(t >> 8), (uint8_t)(t >> 16), (uint8_t)(t >> 24)};
  for (uint8_t x : h) jqPut(x);
  for (size_t i = 0; i < na; i++) jqPut(a[i]);
  for (size_t i = 0; i < nb; i++) jqPut(b[i]);
  jqGive(&jqTxBusy);
  if (pin) { jqOverhead(t0); jqLastAct = esp_timer_get_time(); }
}
static inline void jqFrame(char op, const uint8_t *a, size_t na, const uint8_t *b = nullptr, size_t nb = 0) { jqFrameAt(op, -1, a, na, b, nb); }

/* ---------- Réception (UART1) ---------- */
#define JQ_RX 4200
static uint8_t jqRx[JQ_RX];
static uint16_t jqRxLen = 0, jqRxWant = 0;
static volatile bool jqReplyReady = false;
static uint8_t *jqReplyBuf = nullptr;
static size_t jqReplyMax = 0, jqReplyLen = 0;
static uint64_t jqI2cAck[2] = {0, 0};    // adresses I2C qui ont acquitté : leurs écritures partent sans attendre

struct JqUart { uint8_t num; bool open; int8_t rx, tx; uint32_t baud; uint8_t buf[1024]; volatile uint16_t head, tail; };
static JqUart jqUarts[3];

static void jqEvInsert(uint32_t t, uint8_t pin, uint8_t level) {
  if (jqEvN >= JQ_EVS) { // plein : on garde la fin
    if (jqEvHead == 0) return;
    memmove(jqEv, jqEv + jqEvHead, (jqEvN - jqEvHead) * sizeof(JqEv));
    jqEvN -= jqEvHead; jqEvHead = 0;
  }
  uint16_t i = jqEvN;
  while (i > jqEvHead && (int32_t)(jqEv[i - 1].t - t) > 0) { jqEv[i] = jqEv[i - 1]; i--; }
  jqEv[i] = {t, pin, level};
  jqEvN++;
}
static void jqIsrScan();
/**
 * Changements programmés arrivés à échéance (à l'heure des modules now) : niveaux des broches reliées. isr : les
 * fonctions attachées voient chaque changement l'un après l'autre (comme une interruption au front), pas seulement
 * l'état final quand plusieurs sont dus d'un coup.
 */
static void jqEvApplyAt(uint32_t now, bool isr = false) {
  while (jqEvHead < jqEvN && (int32_t)(jqEv[jqEvHead].t - now) <= 0) {
    const JqEv &e = jqEv[jqEvHead++];
    if (e.pin < JQ_PINS) { if (e.level) jqBrIn |= JQ_BIT(e.pin); else jqBrIn &= ~JQ_BIT(e.pin); }
    if (isr) jqIsrScan();
  }
  if (jqEvHead == jqEvN) jqEvHead = jqEvN = 0;
}
static inline void jqEvApply(bool isr = false) { jqEvApplyAt(jqDev(), isr); }
// Heure des modules dans une interruption fréquente (IRremote : toutes les 50 µs) : esp_timer_get_time() y coûterait
// trop cher dans QEMU ; le compteur de cycles du cœur, recalé sur esp_timer une fois par milliseconde, suffit.
static uint32_t jqCcAt[2], jqDevAt[2], jqCcMhz[2];
static uint32_t IRAM_ATTR jqDevFast() {
  int c = xPortGetCoreID() & 1;
  uint32_t cc = esp_cpu_get_cycle_count(), mhz = jqCcMhz[c] ? jqCcMhz[c] : 240, d = cc - jqCcAt[c];
  if (!jqDevAt[c] || d > mhz * 1000) {
    uint32_t dev = jqDev();
    if (jqDevAt[c] && dev - jqDevAt[c] > 500) { uint32_t m = d / (dev - jqDevAt[c]); if (m >= 10 && m <= 400) jqCcMhz[c] = m; }
    jqCcAt[c] = cc; jqDevAt[c] = dev;
    return dev;
  }
  return jqDevAt[c] + d / mhz;
}

#define JQ_MASK 7 // masques de broches : 7 octets, GPIO 0 à 55 (l'ESP32-S3 va jusqu'à 48)
static inline uint64_t jqMask(const uint8_t *d) { uint64_t m = 0; for (int i = JQ_MASK - 1; i >= 0; i--) m = (m << 8) | d[i]; return m; }
/** Changements programmés encore à venir sur les broches de mask : retirés (une réponse plus récente les remplace). */
static void jqEvDrop(uint64_t mask) {
  uint16_t k = jqEvHead;
  for (uint16_t i = jqEvHead; i < jqEvN; i++) if (!((mask >> jqEv[i].pin) & 1)) jqEv[k++] = jqEv[i];
  jqEvN = k;
  if (jqEvHead == jqEvN) jqEvHead = jqEvN = 0;
}
static void jqHandle(uint8_t op, const uint8_t *d, uint16_t n) {
  switch (op) {
    case 'r': {
      size_t k = n < jqReplyMax ? n : jqReplyMax;
      if (jqReplyBuf) memcpy(jqReplyBuf, d, k);
      jqReplyLen = n;
      jqReplyReady = true;
      break;
    }
    case 'B': { // broches reliées, puis leur niveau (deux masques)
      if (n < 2 * JQ_MASK) break;
      jqBr = jqMask(d);
      jqBrIn = jqMask(d + JQ_MASK);
      jqEvHead = jqEvN = 0;
      jqStale = true;
      jqResyncPending = true;
      break;
    }
    case 'P': // [broche, niveau, instant u32] : instant en temps des modules
      for (uint16_t i = 0; i + 6 <= n; i += 6) jqEvInsert(d[i + 2] | (d[i + 3] << 8) | (d[i + 4] << 16) | ((uint32_t)d[i + 5] << 24), d[i], d[i + 1]);
      break;
    case 'U': {
      if (n < 1 || d[0] > 2) break;
      JqUart &u = jqUarts[d[0]];
      for (uint16_t i = 1; i < n; i++) {
        uint16_t nx = (u.head + 1) % sizeof(u.buf);
        if (nx == u.tail) break; // tampon plein : octet perdu, comme sur le fil
        u.buf[u.head] = d[i]; u.head = nx;
      }
      break;
    }
    case 'N':
      if (n >= 1 && d[0] < 128) jqI2cAck[d[0] >> 6] &= ~(1ULL << (d[0] & 63));
      break;
  }
}

/** Octets reçus de l'application : trames décodées au fil de l'eau. Rend faux si un autre contexte lit déjà. */
static bool jqPump() {
  if (!jqTry(&jqRxBusy)) return false;
  while (JQ_RXCNT(JQ_STATUS)) {
    uint8_t b = (uint8_t)JQ_FIFO;
    if (jqRxLen == 0) {
      if (b == 'I') jqRxWant = 1 + JQ_MASK; else if (b == 'A') jqRxWant = 4; else if (b == 'R') jqRxWant = 4; else continue;
    }
    jqRx[jqRxLen++] = b;
    if (jqRx[0] == 'R' && jqRxLen == 4) {
      uint16_t n = jqRx[2] | (jqRx[3] << 8);
      if (n > JQ_RX - 4) { jqRxLen = 0; continue; } // trame impossible : resynchronisation
      jqRxWant = 4 + n;
    }
    if (jqRxLen < jqRxWant) continue;
    if (jqRx[0] == 'I') {
      uint64_t v = 0;
      for (int i = JQ_MASK; i >= 1; i--) v = (v << 8) | jqRx[i];
      jqIn = v;
      jqGotInputs = true;
    } else if (jqRx[0] == 'A') {
      if (jqRx[1] < JQ_PINS) jqAdc[jqRx[1]] = jqRx[2] | (jqRx[3] << 8);
    } else {
      jqHandle(jqRx[1], jqRx + 4, jqRxWant - 4);
    }
    jqRxLen = 0;
  }
  jqGive(&jqRxBusy);
  return true;
}

/** Niveau d'une broche vue par le programme : sortie, broche reliée à un module, ou montage. */
static inline bool jqLevel(uint8_t p) {
  if ((jqOutMask >> p) & 1) return (jqOut >> p) & 1;
  if ((jqBr >> p) & 1) return (jqBrIn >> p) & 1;
  return (jqIn >> p) & 1;
}
/** Fonctions attachées : appelées pour chaque front vu depuis le dernier passage. */
static void jqIsrScan() {
  for (int p = 0; p < JQ_PINS; p++) {
    if (!jqIsr[p]) continue;
    bool up = jqLevel(p), was = (jqIsrLevel >> p) & 1;
    if (up == was) continue;
    if (up) jqIsrLevel |= JQ_BIT(p); else jqIsrLevel &= ~JQ_BIT(p);
    uint8_t m = jqIsrMode[p];
    if (m == CHANGE || (m == RISING && up) || (m == FALLING && !up) || (m == ONHIGH && up) || (m == ONLOW && !up)) {
      jqIsrTask = xTaskGetCurrentTaskHandle();
      jqIsr[p](jqArg[p]);
      jqIsrTask = nullptr;
    }
  }
}

static bool jqStarted = false;
// Toutes les millisecondes (tâche esp_timer) : trames de l'application, fronts transmis aux fonctions attachées,
// battement qui donne l'heure de la carte.
static void jqPoll(void *) {
  jqPump();
  int64_t now = esp_timer_get_time();
  // Pendant un échange avec un module (appels rapprochés de la carte), c'est le programme qui fait avancer la suite
  // programmée, à l'heure des modules ; ensuite, ce battement s'en charge.
  if (now - jqLastAct > 3000) jqEvApply(true);
  jqIsrScan();
  int64_t hold = jqHold;
  if (!hold && jqStall && now - jqLastAct > 20000) { jqStall = 0; jqLastBr = 0; }
  // Battement : décalage des modules ; pendant une attente, leur heure ne dépasse pas celle où elle finira.
  if (++jqBeat >= 10) {
    jqBeat = 0;
    int64_t dev = now - jqStall;
    if (hold && dev > hold) dev = hold;
    // Échange en cours avec un module : l'appel suivant peut encore retrancher du temps ; le battement ne va pas
    // plus loin que le dernier appel et les attentes demandées depuis.
    int64_t br = jqLastBr;
    if (br && now - jqLastAct < 3000 && dev > br + jqDelaySince) dev = br + jqDelaySince;
    jqSend('T', 0, (uint32_t)(now - dev));
  }
}

/**
 * Requête à l'application, réponse attendue (2 s au plus : sans réponse, l'application est partie et la cale se tait).
 * pin : lecture d'une broche reliée, 1-Wire : le temps de l'attente ne compte pas dans le temps des modules.
 */
static bool jqAsk(const uint8_t *a, size_t na, const uint8_t *b, size_t nb, uint8_t *out, size_t outMax, size_t *outLen, int64_t at = -1, bool pin = false) {
  if (jqDead || !jqStarted || jqIsr_()) return false;
  int64_t t0 = esp_timer_get_time();
  jqReplyBuf = out; jqReplyMax = outMax; jqReplyLen = 0; jqReplyReady = false;
  if (pin) jqHold = t0 - jqStall;
  jqFrameAt('q', at, a, na, b, nb); // son envoi est compté dans l'attente ci-dessous (pas deux fois)
  bool ok = true;
  while (!jqReplyReady) {
    jqPump();
    if (esp_timer_get_time() - t0 > 2000000) { jqDead = true; ok = false; break; }
  }
  jqReplyBuf = nullptr;
  int64_t t1 = esp_timer_get_time();
  if (pin) { jqStall += t1 - t0; jqHold = 0; jqLastAct = t1; }
  if (outLen) *outLen = jqReplyLen < outMax ? jqReplyLen : outMax;
  return ok;
}

// Chiens de garde matériels des groupes de minuteries 0 et 1 coupés : sous QEMU, le temps de la carte suit
// l'horloge de l'ordinateur, et un à-coup de l'émulateur suffit à les déclencher (remises à zéro TG1WDT puis
// TG0WDT sans faute du programme). Un programme vraiment bloqué se voit autrement : plus de battement.
static void jqNoWatchdog() {
  for (uint32_t base : jqTimg) {
    *(volatile uint32_t *)(base + JQ_WDT_PROT) = 0x50D83AA1; // déverrouillage
    *(volatile uint32_t *)(base + JQ_WDT_CFG) = 0;           // arrêt
    *(volatile uint32_t *)(base + JQ_WDT_PROT) = 0;
  }
}
__attribute__((constructor)) static void jqEarly() {
  jqNoWatchdog();
  for (auto &u : jqUarts) { u.rx = -1; u.tx = -1; }
}

static void jqResync();
static void jqStart() {
  bool running = xTaskGetSchedulerState() == taskSCHEDULER_RUNNING && !xPortInIsrContext();
  if (jqTimer) {
    // Démarrée par un constructeur global : premiers niveaux attendus ici, une fois l'ordonnanceur lancé. Broches
    // reliées reçues après des pinMode() faits avant : modes et niveaux renvoyés.
    static bool waited = false;
    if (running && !waited) { waited = true; for (int i = 0; i < 200 && !jqGotInputs; i++) { jqPump(); vTaskDelay(pdMS_TO_TICKS(1) ? pdMS_TO_TICKS(1) : 1); } }
    if (jqResyncPending && running) jqResync();
    return;
  }
  jqNoWatchdog(); // de nouveau : l'initialisation d'Arduino a pu les remettre en marche
  // Constructeurs globaux (AccelStepper, OneWire… appellent pinMode()) : esp_timer n'est pas encore prêt, la
  // création échoue et sera refaite au prochain appel ; « cale prête » ne part qu'une fois par démarrage.
  esp_timer_create_args_t a = {};
  a.callback = jqPoll;
  a.name = "jollof";
  if (esp_timer_create(&a, &jqTimer) == ESP_OK) esp_timer_start_periodic(jqTimer, 1000);
  else jqTimer = nullptr;
  if (!jqStarted) { jqStarted = true; jqSend('J', 0, 1); }
  if (!jqTimer) return;
  // Premiers niveaux des entrées attendus (200 ms au plus) : un bouton lu dans setup() a déjà sa vraie valeur, et
  // les broches reliées aux modules sont connues avant le premier pinMode().
  if (running)
    for (int i = 0; i < 200 && !jqGotInputs; i++) { jqPump(); vTaskDelay(pdMS_TO_TICKS(1) ? pdMS_TO_TICKS(1) : 1); }
  if (jqResyncPending && running) jqResync();
}

// Appelée par initArduino() juste avant setup() (fonction « faible » du cœur, que la carte ESP32 Dev Module ne
// définit pas) : la cale démarre même si le programme n'appelle aucune fonction de broche.
extern "C" void initVariant() { jqStart(); }

/** Changement d'une broche reliée : envoyé dans l'ordre, avec l'heure des modules. */
static void jqPinEvent(char what, uint8_t pin, uint8_t v) {
  if (!jqStarted || jqDead || jqIsr_()) return;
  if (jqResyncPending) jqResync();
  jqBrCall(true);
  uint8_t d[3] = {(uint8_t)what, pin, v};
  jqFrameAt('p', jqLastBr, d, 3, nullptr, 0, true);
  jqStale = true;
}

/** Mode et niveau des broches reliées réglés avant que l'application ne les ait désignées. */
static void jqResync() {
  jqResyncPending = false;
  for (int p = 0; p < JQ_PINS; p++) {
    if (!((jqBr >> p) & 1) || !jqMode[p]) continue;
    jqPinEvent('m', p, jqMode[p]);
    if ((jqOutMask >> p) & 1) jqPinEvent('w', p, (jqOut >> p) & 1);
  }
}

extern "C" void pinMode(uint8_t pin, uint8_t mode) {
  jqStart();
  __pinMode(pin, mode);
  if (pin < JQ_PINS) {
    jqMode[pin] = mode ? mode : 0x01;
    // OUTPUT vaut 0x03 et INPUT 0x01 : c'est le bit 1 qui distingue une sortie (OUTPUT, OUTPUT_OPEN_DRAIN).
    if (mode & 0x02) jqOutMask |= JQ_BIT(pin); else jqOutMask &= ~JQ_BIT(pin);
    if ((jqBr >> pin) & 1) jqPinEvent('m', pin, mode);
  }
  jqSend('M', pin, mode, pin < JQ_PINS && ((jqBr >> pin) & 1));
}

extern "C" void digitalWrite(uint8_t pin, uint8_t val) {
  __digitalWrite(pin, val);
  if (pin < JQ_PINS) {
    bool was = (jqOut >> pin) & 1;
    if (val) jqOut |= JQ_BIT(pin); else jqOut &= ~JQ_BIT(pin);
    if (((jqBr >> pin) & 1) && (!!val != was || !((jqOutMask >> pin) & 1))) jqPinEvent('w', pin, val ? 1 : 0);
  }
}

extern "C" int digitalRead(uint8_t pin) {
  jqStart();
  if (pin >= JQ_PINS) return 0;
  if (((jqBr >> pin) & 1) && !((jqOutMask >> pin) & 1)) {
    if (jqResyncPending && !jqIsr_()) jqResync();
    jqBrCall(false);
    // Broche reliée à un module : après un changement de la carte, on demande où en est la ligne (et la suite
    // programmée : réponse d'un DHT, écho d'un HC-SR04…) ; ensuite la ligne se lit sur place.
    if (jqStale && !jqIsr_()) {
      uint8_t q[2] = {'r', pin}, r[2 * JQ_MASK + 6 * 160];
      size_t n = 0;
      uint32_t tq = (uint32_t)jqLastBr;
      // Réponse : broches concernées, leur niveau maintenant (deux masques), puis leur suite programmée
      // [broche, niveau, délai en µs u32], qui remplace celle qui était prévue pour ces broches.
      if (jqAsk(q, 2, nullptr, 0, r, sizeof r, &n, jqLastBr, true) && n >= 2 * JQ_MASK) {
        uint64_t inc = jqMask(r), lv = jqMask(r + JQ_MASK);
        jqBrIn = (jqBrIn & ~inc) | (lv & inc);
        jqEvDrop(inc);
        for (size_t i = 2 * JQ_MASK; i + 6 <= n; i += 6) jqEvInsert(tq + (r[i + 2] | (r[i + 3] << 8) | (r[i + 4] << 16) | ((uint32_t)r[i + 5] << 24)), r[i], r[i + 1]);
        jqStale = false;
      }
    }
    // Fonction attachée appelée par la cale : elle voit l'état du changement qui l'a déclenchée. Vraie interruption
    // (IRremote lit sa broche toutes les 50 µs) : à l'heure réelle des modules. Programme : à l'heure du dernier appel.
    if (xPortInIsrContext()) { if (jqEvHead < jqEvN) jqEvApplyAt(jqDevFast()); }
    else if (jqIsr_()) {}
    else jqEvApplyAt((uint32_t)jqLastBr);
  }
  return jqLevel(pin);
}

extern "C" uint16_t analogRead(uint8_t pin) {
  jqStart();
  return pin < JQ_PINS ? jqAdc[pin] : 0;
}

extern "C" uint32_t analogReadMilliVolts(uint8_t pin) { return (uint32_t)analogRead(pin) * 3300 / 4095; }

extern "C" void attachInterruptArg(uint8_t pin, void (*fn)(void *), void *arg, int mode) {
  jqStart();
  if (pin < JQ_PINS) {
    jqIsrMode[pin] = mode; jqArg[pin] = arg;
    if (jqLevel(pin)) jqIsrLevel |= JQ_BIT(pin); else jqIsrLevel &= ~JQ_BIT(pin);
    jqIsr[pin] = fn;
  }
}

static void jqCall(void *fn) { ((void (*)(void))fn)(); }
extern "C" void attachInterrupt(uint8_t pin, void (*fn)(void), int mode) { attachInterruptArg(pin, jqCall, (void *)fn, mode); }

extern "C" void detachInterrupt(uint8_t pin) {
  if (pin < JQ_PINS) jqIsr[pin] = nullptr;
}

// micros() et millis() lus par le programme (AccelStepper, anti-rebond, boucles chronométrées) : voir jqBrCall().
extern "C" unsigned long __real_micros();
extern "C" unsigned long __real_millis();
extern "C" unsigned long IRAM_ATTR __wrap_micros() { jqTimeAsked = true; return __real_micros(); }
extern "C" unsigned long IRAM_ATTR __wrap_millis() { jqTimeAsked = true; return __real_millis(); }

// delayMicroseconds() dure ce qui est demandé pour les modules (QEMU le dépasse souvent de plusieurs dizaines de µs).
extern "C" void __real_delayMicroseconds(uint32_t us);
extern "C" void IRAM_ATTR __wrap_delayMicroseconds(uint32_t us) {
  if (!jqStarted || xPortInIsrContext()) { __real_delayMicroseconds(us); return; }
  int64_t t0 = esp_timer_get_time();
  jqHold = t0 - jqStall + us;
  __real_delayMicroseconds(us);
  int64_t dt = esp_timer_get_time() - t0;
  if (dt > (int64_t)us) jqStall += dt - us;
  jqHold = 0;
  if (jqLastBr) jqDelaySince += us;
}

// pulseIn() sur une broche reliée : l'impulsion se lit dans la suite programmée du module (écho d'un HC-SR04…), au
// temps des modules, puis le programme attend sa fin comme sur la vraie carte. Ailleurs : comme le cœur (micros()).
// Remplace wiring_pulse.c du cœur (pulseIn et pulseInLong, seules fonctions de ce fichier).
extern "C" unsigned long pulseIn(uint8_t pin, uint8_t state, unsigned long timeout) {
  state = state ? 1 : 0;
  if (pin < JQ_PINS && ((jqBr >> pin) & 1) && !((jqOutMask >> pin) & 1)) {
    bool lv = digitalRead(pin);
    uint32_t t0 = (uint32_t)jqLastBr, start = 0;
    int phase = lv == state ? 0 : 1; // 0 : fin de l'impulsion en cours, 1 : début attendu, 2 : fin attendue
    for (uint16_t i = jqEvHead; i < jqEvN; i++) {
      const JqEv &e = jqEv[i];
      if (e.pin != pin) continue;
      if ((uint32_t)(e.t - t0) > timeout) break;
      bool l = e.level;
      if (l == lv) continue;
      lv = l;
      if (phase == 0 && l != state) phase = 1;
      else if (phase == 1 && l == state) { phase = 2; start = e.t; }
      else if (phase == 2 && l != state) {
        int32_t wait = (int32_t)(e.t - t0);
        if (wait > 0) delayMicroseconds(wait);
        return e.t - start;
      }
    }
    delayMicroseconds(timeout);
    return 0;
  }
  uint32_t t0 = micros();
  while (digitalRead(pin) == state) if (micros() - t0 > timeout) return 0;
  while (digitalRead(pin) != state) if (micros() - t0 > timeout) return 0;
  uint32_t s = micros();
  while (digitalRead(pin) == state) if (micros() - t0 > timeout) return 0;
  return micros() - s;
}
extern "C" unsigned long pulseInLong(uint8_t pin, uint8_t state, unsigned long timeout) { return pulseIn(pin, state, timeout); }

/* ====================================================================================================== */
/* Bus I2C (Wire) : chaque échange passe par l'application. Une écriture vers une adresse qui a déjà acquitté part
   sans attendre (LCD, écrans OLED : des centaines par seconde) ; lectures et premières écritures attendent la réponse. */
static esp_err_t jqI2cStatus(uint8_t s) { return s == 0 ? ESP_OK : s == 5 ? ESP_ERR_TIMEOUT : ESP_FAIL; }
static inline bool jqAcked(uint16_t a) { return a < 128 && ((jqI2cAck[a >> 6] >> (a & 63)) & 1); }
static inline void jqSetAck(uint16_t a, bool on) {
  if (a >= 128) return;
  if (on) jqI2cAck[a >> 6] |= 1ULL << (a & 63); else jqI2cAck[a >> 6] &= ~(1ULL << (a & 63));
}

extern "C" esp_err_t __wrap_i2cWrite(uint8_t num, uint16_t address, const uint8_t *buff, size_t size, uint32_t timeOutMillis) {
  jqStart();
  uint8_t h[3] = {'W', num, (uint8_t)address};
  if (size > 0 && size <= 4000 && jqAcked(address)) { jqFrame('p', h, 3, buff, size); return ESP_OK; }
  uint8_t r[1] = {2};
  size_t n = 0;
  if (!jqAsk(h, 3, buff, size > 4000 ? 4000 : size, r, 1, &n) || n < 1) return ESP_FAIL;
  jqSetAck(address, r[0] == 0);
  return jqI2cStatus(r[0]);
}

extern "C" esp_err_t __wrap_i2cRead(uint8_t num, uint16_t address, uint8_t *buff, size_t size, uint32_t timeOutMillis, size_t *readCount) {
  jqStart();
  if (readCount) *readCount = 0;
  if (size > 4000) size = 4000;
  uint8_t h[5] = {'R', num, (uint8_t)address, (uint8_t)size, (uint8_t)(size >> 8)};
  static uint8_t r[4001];
  size_t n = 0;
  if (!jqAsk(h, 5, nullptr, 0, r, size + 1, &n) || n < 1) return ESP_FAIL;
  jqSetAck(address, r[0] == 0);
  if (r[0]) return jqI2cStatus(r[0]);
  memcpy(buff, r + 1, n - 1);
  if (readCount) *readCount = n - 1;
  return ESP_OK;
}

extern "C" esp_err_t __wrap_i2cWriteReadNonStop(uint8_t num, uint16_t address, const uint8_t *wbuff, size_t wsize, uint8_t *rbuff, size_t rsize,
                                                uint32_t timeOutMillis, size_t *readCount) {
  jqStart();
  if (readCount) *readCount = 0;
  if (rsize > 4000) rsize = 4000;
  if (wsize > 2000) wsize = 2000;
  static uint8_t q[2008];
  q[0] = 'X'; q[1] = num; q[2] = (uint8_t)address; q[3] = (uint8_t)wsize; q[4] = (uint8_t)(wsize >> 8);
  memcpy(q + 5, wbuff, wsize);
  q[5 + wsize] = (uint8_t)rsize; q[6 + wsize] = (uint8_t)(rsize >> 8);
  static uint8_t r[4001];
  size_t n = 0;
  if (!jqAsk(q, 7 + wsize, nullptr, 0, r, rsize + 1, &n) || n < 1) return ESP_FAIL;
  jqSetAck(address, r[0] == 0);
  if (r[0]) return jqI2cStatus(r[0]);
  memcpy(rbuff, r + 1, n - 1);
  if (readCount) *readCount = n - 1;
  return ESP_OK;
}

/* ====================================================================================================== */
/* Bus SPI : le module sélectionné (broche CS à LOW, digitalWrite reçu juste avant, dans l'ordre) répond octet par
   octet. Les envois seuls partent sans attendre ; un échange (octets reçus utiles) attend la réponse. Les mots de 16
   et 32 bits partent poids fort d'abord (MSBFIRST, le réglage de toutes les bibliothèques de modules). */
static void jqSpiPost(const uint8_t *d, size_t n) {
  uint8_t h[2] = {'S', 0};
  while (n) { size_t k = n > 4000 ? 4000 : n; jqFrame('p', h, 2, d, k); d += k; n -= k; }
}
static void jqSpiXfer(const uint8_t *d, uint8_t *out, size_t n) {
  uint8_t h[2] = {'s', 0};
  while (n) {
    size_t k = n > 4000 ? 4000 : n, got = 0;
    if (!jqAsk(h, 2, d, k, out, k, &got)) { if (out) memset(out, 0xff, k); }
    d += k; if (out) out += k; n -= k;
  }
}
static void jqBe(uint32_t v, uint8_t *b, int n) { for (int i = 0; i < n; i++) b[i] = (uint8_t)(v >> (8 * (n - 1 - i))); }
static uint32_t jqFromBe(const uint8_t *b, int n) { uint32_t v = 0; for (int i = 0; i < n; i++) v = (v << 8) | b[i]; return v; }

extern "C" {
void __wrap_spiWriteByteNL(spi_t *spi, uint8_t data) { jqSpiPost(&data, 1); }
void __wrap_spiWriteByte(spi_t *spi, uint8_t data) { jqSpiPost(&data, 1); }
void __wrap_spiWriteShortNL(spi_t *spi, uint16_t data) { uint8_t b[2]; jqBe(data, b, 2); jqSpiPost(b, 2); }
void __wrap_spiWriteWord(spi_t *spi, uint16_t data) { uint8_t b[2]; jqBe(data, b, 2); jqSpiPost(b, 2); }
void __wrap_spiWriteLongNL(spi_t *spi, uint32_t data) { uint8_t b[4]; jqBe(data, b, 4); jqSpiPost(b, 4); }
void __wrap_spiWriteLong(spi_t *spi, uint32_t data) { uint8_t b[4]; jqBe(data, b, 4); jqSpiPost(b, 4); }
void __wrap_spiWriteNL(spi_t *spi, const void *data, uint32_t len) { jqSpiPost((const uint8_t *)data, len); }
void __wrap_spiWrite(spi_t *spi, const uint32_t *data, uint8_t len) { jqSpiPost((const uint8_t *)data, len * 4); }
void __wrap_spiWritePixelsNL(spi_t *spi, const void *data, uint32_t len) {
  // Pixels de 16 bits rangés en mémoire poids faible d'abord : sur le fil, poids fort d'abord.
  static uint8_t b[512];
  const uint8_t *s = (const uint8_t *)data;
  while (len) {
    uint32_t k = len > sizeof b ? sizeof b : len;
    for (uint32_t i = 0; i + 1 < k; i += 2) { b[i] = s[i + 1]; b[i + 1] = s[i]; }
    if (k & 1) b[k - 1] = s[k - 1];
    jqSpiPost(b, k); s += k; len -= k;
  }
}
uint8_t __wrap_spiTransferByteNL(spi_t *spi, uint8_t data) { uint8_t r = 0xff; jqSpiXfer(&data, &r, 1); return r; }
uint8_t __wrap_spiTransferByte(spi_t *spi, uint8_t data) { uint8_t r = 0xff; jqSpiXfer(&data, &r, 1); return r; }
uint16_t __wrap_spiTransferShortNL(spi_t *spi, uint16_t data) { uint8_t b[2], r[2]; jqBe(data, b, 2); jqSpiXfer(b, r, 2); return jqFromBe(r, 2); }
uint16_t __wrap_spiTransferWord(spi_t *spi, uint16_t data) { uint8_t b[2], r[2]; jqBe(data, b, 2); jqSpiXfer(b, r, 2); return jqFromBe(r, 2); }
uint32_t __wrap_spiTransferLongNL(spi_t *spi, uint32_t data) { uint8_t b[4], r[4]; jqBe(data, b, 4); jqSpiXfer(b, r, 4); return jqFromBe(r, 4); }
uint32_t __wrap_spiTransferLong(spi_t *spi, uint32_t data) { uint8_t b[4], r[4]; jqBe(data, b, 4); jqSpiXfer(b, r, 4); return jqFromBe(r, 4); }
void __wrap_spiTransferBytesNL(spi_t *spi, const void *data, uint8_t *out, uint32_t len) {
  static uint8_t ff[256];
  if (data) { jqSpiXfer((const uint8_t *)data, out, len); return; }
  memset(ff, 0xff, sizeof ff); // pas de données : on envoie 0xFF (lecture d'une carte SD)
  while (len) { uint32_t k = len > sizeof ff ? sizeof ff : len; jqSpiXfer(ff, out, k); if (out) out += k; len -= k; }
}
void __wrap_spiTransferBytes(spi_t *spi, const uint8_t *data, uint8_t *out, uint32_t len) { __wrap_spiTransferBytesNL(spi, data, out, len); }
void __wrap_spiTransfer(spi_t *spi, uint32_t *data, uint8_t len) { jqSpiXfer((const uint8_t *)data, (uint8_t *)data, len * 4); }
void __wrap_spiTransferBitsNL(spi_t *spi, uint32_t data, uint32_t *out, uint8_t bits) {
  int n = (bits + 7) / 8; if (n < 1) n = 1; if (n > 4) n = 4;
  uint8_t b[4], r[4]; jqBe(data, b, n); jqSpiXfer(b, r, n);
  if (out) *out = jqFromBe(r, n);
}
void __wrap_spiTransferBits(spi_t *spi, uint32_t data, uint32_t *out, uint8_t bits) { __wrap_spiTransferBitsNL(spi, data, out, bits); }
}

/* ====================================================================================================== */
/* RMT (NeoPixel, LED RVB de la carte) : les symboles (durée et niveau des deux moitiés) partent tels quels ;
   l'application les rejoue sur la broche, à la durée près, vers le modèle de la barrette WS2812. */
static uint32_t jqRmtHz[JQ_PINS];
extern "C" {
bool __wrap_rmtInit(int pin, rmt_ch_dir_t dir, rmt_reserve_memsize_t mem, uint32_t hz) {
  jqStart();
  if (pin < 0 || pin >= JQ_PINS || dir != RMT_TX_MODE) return false;
  jqRmtHz[pin] = hz ? hz : 10000000;
  return true;
}
bool __wrap_rmtDeinit(int pin) { if (pin >= 0 && pin < JQ_PINS) jqRmtHz[pin] = 0; return true; }
bool __wrap_rmtSetEOT(int pin, uint8_t level) { return true; }
bool __wrap_rmtSetCarrier(int pin, bool en, bool level, uint32_t hz, float duty) { return true; }
bool __wrap_rmtTransmitCompleted(int pin) { return true; }
static bool jqRmtSend(int pin, rmt_data_t *data, size_t n) {
  if (pin < 0 || pin >= JQ_PINS || !jqRmtHz[pin]) return false;
  uint32_t hz = jqRmtHz[pin];
  uint8_t h[6] = {'K', (uint8_t)pin, (uint8_t)hz, (uint8_t)(hz >> 8), (uint8_t)(hz >> 16), (uint8_t)(hz >> 24)};
  const uint8_t *d = (const uint8_t *)data;
  size_t bytes = n * 4;
  while (bytes) { size_t k = bytes > 4000 ? 4000 : bytes; jqFrame('p', h, 6, d, k); d += k; bytes -= k; }
  return true;
}
bool __wrap_rmtWrite(int pin, rmt_data_t *data, size_t n, uint32_t timeout) { return jqRmtSend(pin, data, n); }
bool __wrap_rmtWriteAsync(int pin, rmt_data_t *data, size_t n) { return jqRmtSend(pin, data, n); }
bool __wrap_rmtWriteLooping(int pin, rmt_data_t *data, size_t n) { return jqRmtSend(pin, data, n); }
}

/* ====================================================================================================== */
/* Serial1 et Serial2 : ports série virtuels. L'UART1 sert à la cale, Serial2 n'a pas de modèle de module dans QEMU :
   leurs octets passent par l'application (modules HC-05, GPS, SIM800…), à la vitesse et sur les broches choisies
   par begin(). Serial (UART0) reste le vrai port de QEMU : le moniteur série. */
static JqUart *jqU(uart_t *u) { for (auto &x : jqUarts) if ((uart_t *)&x == u) return &x; return nullptr; }
static void jqUartCfg(JqUart &u) {
  uint8_t d[8] = {'u', u.num, (uint8_t)u.rx, (uint8_t)u.tx, (uint8_t)u.baud, (uint8_t)(u.baud >> 8), (uint8_t)(u.baud >> 16), (uint8_t)(u.baud >> 24)};
  if (u.open) jqFrame('p', d, 8);
}
extern "C" {
uart_t *__real_uartBegin(uint8_t, uint32_t, uint32_t, int8_t, int8_t, uint32_t, uint32_t, bool, uint8_t);
bool __real__testUartBegin(uint8_t, uint32_t, uint32_t, int8_t, int8_t, uint32_t, uint32_t, bool, uint8_t);
void __real_uartEnd(uint8_t);
uint32_t __real_uartAvailable(uart_t *);
uint32_t __real_uartAvailableForWrite(uart_t *);
size_t __real_uartReadBytes(uart_t *, uint8_t *, size_t, uint32_t);
uint8_t __real_uartRead(uart_t *);
uint8_t __real_uartPeek(uart_t *);
void __real_uartWrite(uart_t *, uint8_t);
void __real_uartWriteBuf(uart_t *, const uint8_t *, size_t);
void __real_uartFlush(uart_t *);
void __real_uartFlushTxOnly(uart_t *, bool);
void __real_uartSetBaudRate(uart_t *, uint32_t);
uint32_t __real_uartGetBaudRate(uart_t *);
void __real_uartSetRxInvert(uart_t *, bool);
bool __real_uartSetRxTimeout(uart_t *, uint8_t);
bool __real_uartSetRxFIFOFull(uart_t *, uint8_t);
bool __real_uartIsDriverInstalled(uart_t *);
bool __real_uartSetPins(uint8_t, int8_t, int8_t, int8_t, int8_t);
int8_t __real_uart_get_RxPin(uint8_t);
int8_t __real_uart_get_TxPin(uint8_t);
void __real_uartGetEventQueue(uart_t *, QueueHandle_t *);
bool __real_uartSetHwFlowCtrlMode(uart_t *, uart_hw_flowcontrol_t, uint8_t);
bool __real_uartSetMode(uart_t *, uart_mode_t);
void __real_uartSetDebug(uart_t *);
void __real_uartStartDetectBaudrate(uart_t *);
unsigned long __real_uartDetectBaudrate(uart_t *);

bool __wrap__testUartBegin(uint8_t nr, uint32_t baud, uint32_t cfg, int8_t rx, int8_t tx, uint32_t rxb, uint32_t txb, bool inv, uint8_t th) {
  if (nr == 1 || nr == 2) return false;
  return __real__testUartBegin(nr, baud, cfg, rx, tx, rxb, txb, inv, th);
}
uart_t *__wrap_uartBegin(uint8_t nr, uint32_t baud, uint32_t cfg, int8_t rx, int8_t tx, uint32_t rxb, uint32_t txb, bool inv, uint8_t th) {
  if (nr != 1 && nr != 2) return __real_uartBegin(nr, baud, cfg, rx, tx, rxb, txb, inv, th);
  jqStart();
  JqUart &u = jqUarts[nr];
  u.num = nr; u.open = true; u.baud = baud;
  if (rx >= 0) u.rx = rx;
  if (tx >= 0) u.tx = tx;
  jqUartCfg(u);
  return (uart_t *)&u;
}
void __wrap_uartEnd(uint8_t nr) { if (nr == 1 || nr == 2) jqUarts[nr].open = false; else __real_uartEnd(nr); }
static uint32_t jqUAvail(JqUart &u) { jqPump(); return (u.head + sizeof(u.buf) - u.tail) % sizeof(u.buf); }
uint32_t __wrap_uartAvailable(uart_t *x) { JqUart *u = jqU(x); return u ? jqUAvail(*u) : __real_uartAvailable(x); }
uint32_t __wrap_uartAvailableForWrite(uart_t *x) { return jqU(x) ? 128 : __real_uartAvailableForWrite(x); }
size_t __wrap_uartReadBytes(uart_t *x, uint8_t *buf, size_t size, uint32_t timeout) {
  JqUart *u = jqU(x);
  if (!u) return __real_uartReadBytes(x, buf, size, timeout);
  size_t n = 0;
  uint32_t t0 = millis();
  while (n < size) {
    if (jqUAvail(*u)) { buf[n++] = u->buf[u->tail]; u->tail = (u->tail + 1) % sizeof(u->buf); continue; }
    if (millis() - t0 >= timeout) break;
    vTaskDelay(1);
  }
  return n;
}
uint8_t __wrap_uartRead(uart_t *x) { uint8_t c = 0; JqUart *u = jqU(x); if (!u) return __real_uartRead(x); __wrap_uartReadBytes(x, &c, 1, 0); return c; }
uint8_t __wrap_uartPeek(uart_t *x) { JqUart *u = jqU(x); if (!u) return __real_uartPeek(x); return jqUAvail(*u) ? u->buf[u->tail] : 0; }
void __wrap_uartWriteBuf(uart_t *x, const uint8_t *data, size_t len) {
  JqUart *u = jqU(x);
  if (!u) { __real_uartWriteBuf(x, data, len); return; }
  uint8_t h[2] = {'U', u->num};
  while (len) { size_t k = len > 4000 ? 4000 : len; jqFrame('p', h, 2, data, k); data += k; len -= k; }
}
void __wrap_uartWrite(uart_t *x, uint8_t c) { if (jqU(x)) __wrap_uartWriteBuf(x, &c, 1); else __real_uartWrite(x, c); }
void __wrap_uartFlush(uart_t *x) { if (!jqU(x)) __real_uartFlush(x); }
void __wrap_uartFlushTxOnly(uart_t *x, bool txOnly) {
  JqUart *u = jqU(x);
  if (!u) { __real_uartFlushTxOnly(x, txOnly); return; }
  if (!txOnly) u->tail = u->head;
}
void __wrap_uartSetBaudRate(uart_t *x, uint32_t baud) { JqUart *u = jqU(x); if (!u) { __real_uartSetBaudRate(x, baud); return; } u->baud = baud; jqUartCfg(*u); }
uint32_t __wrap_uartGetBaudRate(uart_t *x) { JqUart *u = jqU(x); return u ? u->baud : __real_uartGetBaudRate(x); }
void __wrap_uartSetRxInvert(uart_t *x, bool inv) { if (!jqU(x)) __real_uartSetRxInvert(x, inv); }
bool __wrap_uartSetRxTimeout(uart_t *x, uint8_t n) { return jqU(x) ? true : __real_uartSetRxTimeout(x, n); }
bool __wrap_uartSetRxFIFOFull(uart_t *x, uint8_t n) { return jqU(x) ? true : __real_uartSetRxFIFOFull(x, n); }
bool __wrap_uartIsDriverInstalled(uart_t *x) { JqUart *u = jqU(x); return u ? u->open : __real_uartIsDriverInstalled(x); }
bool __wrap_uartSetPins(uint8_t nr, int8_t rx, int8_t tx, int8_t cts, int8_t rts) {
  if (nr != 1 && nr != 2) return __real_uartSetPins(nr, rx, tx, cts, rts);
  JqUart &u = jqUarts[nr];
  u.num = nr;
  if (rx >= 0) u.rx = rx;
  if (tx >= 0) u.tx = tx;
  jqUartCfg(u);
  return true;
}
int8_t __wrap_uart_get_RxPin(uint8_t nr) { return (nr == 1 || nr == 2) ? (jqUarts[nr].num ? jqUarts[nr].rx : -1) : __real_uart_get_RxPin(nr); }
int8_t __wrap_uart_get_TxPin(uint8_t nr) { return (nr == 1 || nr == 2) ? (jqUarts[nr].num ? jqUarts[nr].tx : -1) : __real_uart_get_TxPin(nr); }
void __wrap_uartGetEventQueue(uart_t *x, QueueHandle_t *q) { if (jqU(x)) *q = NULL; else __real_uartGetEventQueue(x, q); }
bool __wrap_uartSetHwFlowCtrlMode(uart_t *x, uart_hw_flowcontrol_t m, uint8_t t) { return jqU(x) ? true : __real_uartSetHwFlowCtrlMode(x, m, t); }
bool __wrap_uartSetMode(uart_t *x, uart_mode_t m) { return jqU(x) ? true : __real_uartSetMode(x, m); }
void __wrap_uartSetDebug(uart_t *x) { if (!jqU(x)) __real_uartSetDebug(x); }
void __wrap_uartStartDetectBaudrate(uart_t *x) { if (!jqU(x)) __real_uartStartDetectBaudrate(x); }
unsigned long __wrap_uartDetectBaudrate(uart_t *x) { JqUart *u = jqU(x); return u ? u->baud : __real_uartDetectBaudrate(x); }
}

/* ====================================================================================================== */
/* 1-Wire (bibliothèque OneWire) : ses créneaux de quelques microsecondes passent par les registres GPIO, que QEMU
   n'émule pas. Ses fonctions publiques sont remplacées : l'application joue chaque créneau, au temps des modules,
   contre le modèle des sondes DS18B20 (src/emu/devices/ds18b20.js). Le premier champ de l'objet est la broche
   (PIN_TO_BITMASK(pin) = pin sur l'ESP32). La recherche garde son état ici, par objet. */
struct JqOw { void *self; uint8_t rom[8]; uint8_t last, lastFamily; bool lastDevice; };
static JqOw jqOw[4];
static JqOw &jqOwOf(void *self) {
  for (auto &o : jqOw) if (o.self == self) return o;
  for (auto &o : jqOw) if (!o.self) { o = {}; o.self = self; return o; }
  return jqOw[0];
}
static inline uint8_t jqOwPin(void *self) { return (uint8_t) * (uint32_t *)self; }
static bool jqOwAsk(void *self, char op, const uint8_t *d, size_t n, uint8_t *out, size_t outMax, size_t *got = nullptr) {
  jqStart();
  uint8_t h[3] = {'O', jqOwPin(self), (uint8_t)op};
  return jqAsk(h, 3, d, n, out, outMax, got); // temps réel : les créneaux se jouent dans l'application
}
static void jqOwPost(void *self, char op, const uint8_t *d, size_t n) {
  jqStart();
  uint8_t h[3] = {'O', jqOwPin(self), (uint8_t)op};
  jqFrame('p', h, 3, d, n);
}
extern "C" {
uint8_t __wrap__ZN7OneWire5resetEv(void *self) { uint8_t r = 0; return jqOwAsk(self, 'r', nullptr, 0, &r, 1) ? r : 0; }
void __wrap__ZN7OneWire5writeEhh(void *self, uint8_t v, uint8_t power) { jqOwPost(self, 'w', &v, 1); }
void __wrap__ZN7OneWire11write_bytesEPKhtb(void *self, const uint8_t *buf, uint16_t n, bool power) { jqOwPost(self, 'w', buf, n); }
uint8_t __wrap__ZN7OneWire4readEv(void *self) { uint8_t c = 1, r = 0xff; jqOwAsk(self, 'R', &c, 1, &r, 1); return r; }
void __wrap__ZN7OneWire10read_bytesEPht(void *self, uint8_t *buf, uint16_t n) {
  while (n) { uint8_t c = n > 200 ? 200 : n; if (!jqOwAsk(self, 'R', &c, 1, buf, c)) memset(buf, 0xff, c); buf += c; n -= c; }
}
void __wrap__ZN7OneWire6selectEPKh(void *self, const uint8_t *rom) { uint8_t b[9] = {0x55}; memcpy(b + 1, rom, 8); jqOwPost(self, 'w', b, 9); }
void __wrap__ZN7OneWire4skipEv(void *self) { uint8_t b = 0xCC; jqOwPost(self, 'w', &b, 1); }
void __wrap__ZN7OneWire9write_bitEh(void *self, uint8_t v) { uint8_t b = v & 1; jqOwPost(self, 'b', &b, 1); }
uint8_t __wrap__ZN7OneWire8read_bitEv(void *self) { uint8_t r = 1; jqOwAsk(self, 'B', nullptr, 0, &r, 1); return r & 1; }
void __wrap__ZN7OneWire7depowerEv(void *self) {}
void __wrap__ZN7OneWire12reset_searchEv(void *self) { JqOw &o = jqOwOf(self); memset(o.rom, 0, 8); o.last = o.lastFamily = 0; o.lastDevice = false; }
void __wrap__ZN7OneWire13target_searchEh(void *self, uint8_t family) {
  JqOw &o = jqOwOf(self); memset(o.rom, 0, 8); o.rom[0] = family; o.last = 64; o.lastFamily = 0; o.lastDevice = false;
}
// Recherche (algorithme de Maxim, note d'application 187) jouée par l'application : état envoyé, état rendu.
bool __wrap__ZN7OneWire6searchEPhb(void *self, uint8_t *newAddr, bool searchMode) {
  JqOw &o = jqOwOf(self);
  if (o.lastDevice) { o.last = o.lastFamily = 0; o.lastDevice = false; return false; }
  uint8_t q[11], r[12] = {0};
  memcpy(q, o.rom, 8); q[8] = o.last; q[9] = o.lastFamily; q[10] = searchMode ? 0xF0 : 0xEC;
  size_t n = 0;
  if (!jqOwAsk(self, 's', q, 11, r, 12, &n) || n < 12 || !r[0]) { o.last = o.lastFamily = 0; o.lastDevice = false; return false; }
  memcpy(o.rom, r + 1, 8); o.last = r[9]; o.lastFamily = r[10]; o.lastDevice = r[11];
  memcpy(newAddr, o.rom, 8);
  return true;
}
}
