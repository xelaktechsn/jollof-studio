// module: {"type":"max30102","addr":[87],"data":{"bpm":75,"spo2":97,"finger":1,"temp":31.2}}
// expect: id=0x15
// expect: temp=31.2
// expect: doigt=1
// expect: bpm=7
// run-ms: 4000
// Oxymètre MAX30102 avec la bibliothèque SparkFun MAX3010x : réglages de l'exemple (moyenne de 4, 3 LED, 400 Hz,
// 411 µs, 4096 nA), température de la puce, puis battements détectés par checkForBeat (heartRate.h) sur l'infrarouge.
#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"
MAX30105 capteur;
long dernier = 0; int n = 0;
void setup() {
  Serial.begin(115200);
  if (!capteur.begin(Wire, I2C_SPEED_FAST)) { Serial.println("MAX30102 absent"); while (1); }
  Serial.print("id=0x"); Serial.println(capteur.readPartID(), HEX);
  capteur.setup();
  capteur.setPulseAmplitudeRed(0x0A);
  Serial.print("temp="); Serial.println(capteur.readTemperature(), 1);
  Serial.print("doigt="); Serial.println(capteur.getIR() > 50000 ? 1 : 0);
}
void loop() {
  long ir = capteur.getIR();
  if (checkForBeat(ir)) {
    long d = millis() - dernier; dernier = millis();
    if (++n > 2) { Serial.print("bpm="); Serial.println(60000L / d); }
  }
}
