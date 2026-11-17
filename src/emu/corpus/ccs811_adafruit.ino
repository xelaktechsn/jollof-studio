// module: {"type":"ccs811","addr":[90],"levels":{"WAKE":0},"data":{"eco2":1250,"tvoc":128}}
// expect: pret
// expect: CO2=1250 TVOC=128
// not-expect: ERREUR
// run-ms: 2600
// Qualité de l'air CCS811 (module CJMCU-811, WAKE à la masse) avec la bibliothèque d'Adafruit : remise à zéro
// logicielle, identifiant 0x81, démarrage du micrologiciel (APP_START), mode 1 (une mesure par seconde).
#include "Adafruit_CCS811.h"
Adafruit_CCS811 ccs;
void setup() {
  Serial.begin(9600);
  if (!ccs.begin()) { Serial.println("CCS811 absent"); while (1); }
  while (!ccs.available());
  Serial.println("pret");
}
void loop() {
  if (ccs.available()) {
    if (!ccs.readData()) { Serial.print("CO2="); Serial.print(ccs.geteCO2()); Serial.print(" TVOC="); Serial.println(ccs.getTVOC()); }
    else Serial.println("ERREUR");
  }
  delay(500);
}
