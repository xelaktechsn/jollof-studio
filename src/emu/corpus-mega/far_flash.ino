// expect: taille>128K=1 appel>128K=1
// expect: far=11,22 fin=0,7 fn=42 ms=ok
// run-ms: 400
// Programme de plus de 128 Ko : 132 Ko d'instructions NOP en tête du programme repoussent le reste du code au-delà de
// 0x20000 (compteur ordinal de 22 bits, adresses de retour de 3 octets, appels indirects par EIND, vecteurs
// d'interruption vers du code lointain) ; deux tables placées après le code se lisent avec ELPM (RAMPZ).
#include <avr/pgmspace.h>
void __attribute__((noinline)) bourrage() { __asm__ __volatile__(".rept 66000\n\tnop\n\t.endr"); }
const uint8_t loin1[30000] __attribute__((section(".fini7"), used)) = { 11 };
struct Table { uint8_t debut[29999]; uint8_t fin; };
const Table loin2 __attribute__((section(".fini7"), used)) = { { 22 }, 7 };
volatile byte k = 0;
uint8_t far(uint_farptr_t p, unsigned i) { return pgm_read_byte_far(p + i); }
int quarante(int x) { return x + 40; }
int (*volatile fp)(int) = quarante;
extern char _etext;
// Adresse de retour empilée par l'appel (3 octets sur l'ATmega2560, en mots) : où se trouve l'appelant.
uint32_t retour() __attribute__((naked, noinline));
uint32_t retour() {
  __asm__ __volatile__("in r30, __SP_L__\n\tin r31, __SP_H__\n\tldd r22, Z+3\n\tldd r23, Z+2\n\tldd r24, Z+1\n\tldi r25, 0\n\tret");
}
void setup() {
  bourrage();
  Serial.begin(9600);
  Serial.print("taille>128K="); Serial.print(pgm_get_far_address(_etext) > 0x20000UL);
  Serial.print(" appel>128K="); Serial.println(2 * retour() > 0x20000UL);
  Serial.print("far="); Serial.print(far(pgm_get_far_address(loin1), k)); Serial.print(','); Serial.print(far(pgm_get_far_address(loin2), k));
  Serial.print(" fin="); Serial.print(far(pgm_get_far_address(loin1), 29999 - k)); Serial.print(','); Serial.print(far(pgm_get_far_address(loin2), 29999 - k));
  Serial.print(" fn="); Serial.print(fp(2));
  unsigned long t0 = millis(); delay(100); unsigned long d = millis() - t0;
  Serial.print(" ms="); Serial.println(d >= 100 && d <= 102 ? "ok" : "KO");
}
void loop() {}
