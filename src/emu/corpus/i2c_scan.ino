// expect: found=0
// Bus I2C sans module : aucune adresse ne répond.
#include <Wire.h>
void setup() {
  Serial.begin(9600); Wire.begin();
  int n = 0;
  for (byte a = 1; a < 127; a++) { Wire.beginTransmission(a); if (Wire.endTransmission() == 0) n++; }
  Serial.print("found="); Serial.println(n);
}
void loop() {}
