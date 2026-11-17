// module: {"type":"tcs34725","addr":[41],"data":{"rgb":16744448,"lux":300}}
// expect: TCS34725 ok
// expect: R=1148 G=576 B=0 C=1724
// expect: K=1391 lux=536
// expect: rgb=169,85,0
// run-ms: 2600
// Couleur TCS34725 avec la bibliothèque d'Adafruit : lumière orange (#FF8000) de 300 lx, intégration de 614 ms au
// gain 1 ; comptes bruts, température de couleur (DN40), éclairement, couleur normalisée par le canal clair.
#include <Wire.h>
#include "Adafruit_TCS34725.h"
Adafruit_TCS34725 tcs = Adafruit_TCS34725(TCS34725_INTEGRATIONTIME_614MS, TCS34725_GAIN_1X);
void setup() {
  Serial.begin(9600);
  if (tcs.begin()) Serial.println("TCS34725 ok"); else { Serial.println("absent"); while (1); }
}
void loop() {
  uint16_t r, g, b, c;
  tcs.getRawData(&r, &g, &b, &c);
  Serial.print("R="); Serial.print(r); Serial.print(" G="); Serial.print(g); Serial.print(" B="); Serial.print(b); Serial.print(" C="); Serial.println(c);
  Serial.print("K="); Serial.print(tcs.calculateColorTemperature_dn40(r, g, b, c)); Serial.print(" lux="); Serial.println(tcs.calculateLux(r, g, b));
  float fr, fg, fb; tcs.getRGB(&fr, &fg, &fb);
  Serial.print("rgb="); Serial.print((int)fr); Serial.print(","); Serial.print((int)fg); Serial.print(","); Serial.println((int)fb);
}
