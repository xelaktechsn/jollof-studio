// module: {"type":"vl53l0x","addr":[41],"data":{"mm":612}}
// expect: pret
// expect: unique=612
// expect: d=612
// not-expect: TIMEOUT
// run-ms: 500
// VL53L0X avec la bibliothèque de Pololu : init(), une mesure unique, puis des mesures continues (back-to-back),
// délai d'attente réglé.
#include <Wire.h>
#include <VL53L0X.h>
VL53L0X capteur;
void setup() {
  Serial.begin(9600);
  Wire.begin();
  capteur.setTimeout(500);
  if (!capteur.init()) { Serial.println("Echec"); while (1) {} }
  Serial.print("unique="); Serial.println(capteur.readRangeSingleMillimeters());
  capteur.startContinuous();
  Serial.println("pret");
}
void loop() {
  uint16_t d = capteur.readRangeContinuousMillimeters();
  Serial.print("d="); Serial.print(d);
  if (capteur.timeoutOccurred()) Serial.print(" TIMEOUT");
  Serial.println();
  delay(50);
}
