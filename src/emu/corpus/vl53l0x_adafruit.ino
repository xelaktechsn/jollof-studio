// module: {"type":"vl53l0x","addr":[41],"data":{"mm":257}}
// expect: VL53L0X ok
// expect: mm=257 st=0
// not-expect: hors de portee
// run-ms: 700
// Distance par temps de vol VL53L0X avec la bibliothèque d'Adafruit (API complète d'ST) : initialisation, gestion des
// SPAD de référence, étalonnages VHV et de phase, puis mesures uniques (rangingTest) et état de la mesure.
#include <Adafruit_VL53L0X.h>
Adafruit_VL53L0X lox = Adafruit_VL53L0X();
void setup() {
  Serial.begin(115200);
  if (!lox.begin()) { Serial.println(F("Echec VL53L0X")); while (1); }
  Serial.println(F("VL53L0X ok"));
}
void loop() {
  VL53L0X_RangingMeasurementData_t mesure;
  lox.rangingTest(&mesure, false);
  if (mesure.RangeStatus != 4) { Serial.print(F("mm=")); Serial.print(mesure.RangeMilliMeter); Serial.print(F(" st=")); Serial.println(mesure.RangeStatus); }
  else Serial.println(F("hors de portee"));
  delay(100);
}
