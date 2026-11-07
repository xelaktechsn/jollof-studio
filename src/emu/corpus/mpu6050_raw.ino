// expect: who=0x68
// expect: pwr=0x40
// expect: sleep ax=0
// expect: ax=8192 ay=-4096 az=13107
// expect: gx=751 gz=11259
// expect: t=28.40
// expect: az8g=3277
// module: {"type":"mpu6050","addr":[104],"data":{"ax":0.5,"ay":-0.25,"az":0.8,"gx":0.1,"gy":-0.2,"gz":1.5,"temp":28.4}}
// run-ms: 400
// MPU-6050 lu sans bibliothèque : WHO_AM_I (0x75), PWR_MGMT_1 (0x6B) à 0x40 au démarrage (puce endormie : mesures
// à 0), réveil (0x6B = 0), puis 14 octets à partir de 0x3B, poids fort d'abord. Plages par défaut : ±2 g, ±250 °/s.
#include <Wire.h>
const byte MPU = 0x68;
byte reg(byte r) { Wire.beginTransmission(MPU); Wire.write(r); Wire.endTransmission(false); Wire.requestFrom(MPU, (uint8_t)1); return Wire.read(); }
void wr(byte r, byte v) { Wire.beginTransmission(MPU); Wire.write(r); Wire.write(v); Wire.endTransmission(); }
int16_t v[7];
void readAll() {
  Wire.beginTransmission(MPU); Wire.write(0x3B); Wire.endTransmission(false);
  Wire.requestFrom(MPU, (uint8_t)14);
  for (byte i = 0; i < 7; i++) { v[i] = Wire.read() << 8; v[i] |= Wire.read(); }
}
void setup() {
  Serial.begin(9600); Wire.begin();
  Serial.print(F("who=0x")); Serial.println(reg(0x75), HEX);
  Serial.print(F("pwr=0x")); Serial.println(reg(0x6B), HEX);
  readAll(); Serial.print(F("sleep ax=")); Serial.println(v[0]);
  wr(0x6B, 0);
  delay(20);
  readAll();
  Serial.print(F("ax=")); Serial.print(v[0]); Serial.print(F(" ay=")); Serial.print(v[1]); Serial.print(F(" az=")); Serial.println(v[2]);
  Serial.print(F("gx=")); Serial.print(v[4]); Serial.print(F(" gz=")); Serial.println(v[6]);
  Serial.print(F("t=")); Serial.println(v[3] / 340.0 + 36.53);
  wr(0x1C, 0x10); // ACCEL_CONFIG : ±8 g, 4096 pas par g
  readAll(); Serial.print(F("az8g=")); Serial.println(v[2]);
}
void loop() {}
