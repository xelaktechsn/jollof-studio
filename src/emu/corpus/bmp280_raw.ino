// expect: id=0x58
// expect: raw0=524288
// expect: T1=27504 P9=6000
// expect: T=2450
// expect: P=10073
// module: {"type":"bmp280","addr":[118],"data":{"temp":24.5,"press":1007.35}}
// run-ms: 400
// BMP280 lu registre par registre, sans bibliothèque : identifiant (0xD0), coefficients d'étalonnage (0x88, petit
// boutiste), mise en mode normal (0xF4 = 0x27 : ×1, ×1), mesures brutes de 20 bits (0xF7), puis formules entières
// de la fiche technique (température en 0,01 °C, pression en Pa). Avant la première mesure, les registres valent 0x80000.
#include <Wire.h>
const byte BMP = 0x76;
uint16_t T1, P1; int16_t T2, T3, P2, P3, P4, P5, P6, P7, P8, P9;
void rd(byte r, byte *b, byte n) {
  Wire.beginTransmission(BMP); Wire.write(r); Wire.endTransmission(false);
  Wire.requestFrom(BMP, n); for (byte i = 0; i < n; i++) b[i] = Wire.read();
}
void wr(byte r, byte v) { Wire.beginTransmission(BMP); Wire.write(r); Wire.write(v); Wire.endTransmission(); }
long adc(byte *b) { return ((long)b[0] << 12) | ((long)b[1] << 4) | (b[2] >> 4); }
void setup() {
  Serial.begin(9600); Wire.begin();
  byte b[24];
  rd(0xD0, b, 1); Serial.print(F("id=0x")); Serial.println(b[0], HEX);
  rd(0xF7, b, 6); Serial.print(F("raw0=")); Serial.println(adc(b + 3));
  rd(0x88, b, 24);
  uint16_t *u = (uint16_t *)b; // l'AVR est petit boutiste, comme les registres d'étalonnage
  T1 = u[0]; T2 = u[1]; T3 = u[2]; P1 = u[3]; P2 = u[4]; P3 = u[5]; P4 = u[6]; P5 = u[7]; P6 = u[8]; P7 = u[9]; P8 = u[10]; P9 = u[11];
  Serial.print(F("T1=")); Serial.print(T1); Serial.print(F(" P9=")); Serial.println(P9);
  wr(0xF4, 0x27);
  delay(50);
  rd(0xF7, b, 6);
  long aP = adc(b), aT = adc(b + 3);
  long v1 = ((((aT >> 3) - ((long)T1 << 1))) * ((long)T2)) >> 11;
  long v2 = (((((aT >> 4) - (long)T1) * ((aT >> 4) - (long)T1)) >> 12) * (long)T3) >> 14;
  long tf = v1 + v2;
  Serial.print(F("T=")); Serial.println((tf * 5 + 128) >> 8);
  // Pression : version 32 bits de la fiche technique (au pascal près).
  v1 = (tf >> 1) - 64000L;
  v2 = (((v1 >> 2) * (v1 >> 2)) >> 11) * (long)P6;
  v2 = v2 + ((v1 * (long)P5) << 1);
  v2 = (v2 >> 2) + ((long)P4 << 16);
  v1 = ((((long)P3 * (((v1 >> 2) * (v1 >> 2)) >> 13)) >> 3) + (((long)P2 * v1) >> 1)) >> 18;
  v1 = ((32768L + v1) * (long)P1) >> 15;
  unsigned long p = ((unsigned long)(1048576L - aP) - (v2 >> 12)) * 3125;
  p = p < 0x80000000UL ? (p << 1) / (unsigned long)v1 : (p / (unsigned long)v1) * 2;
  v1 = ((long)P9 * (long)(((p >> 3) * (p >> 3)) >> 13)) >> 12;
  v2 = ((long)(p >> 2) * (long)P8) >> 13;
  p = (unsigned long)((long)p + ((v1 + v2 + P7) >> 4));
  Serial.print(F("P=")); Serial.println(p);
}
void loop() {}
