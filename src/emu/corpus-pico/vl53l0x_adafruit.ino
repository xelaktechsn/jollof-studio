// module: {"type":"vl53l0x","addr":[41],"data":{"mm":905}}
// expect: VL53L0X ok
// expect: mm=905 st=0
// run-ms: 700
// VL53L0X sur le bus I2C matériel du Pico (Wire : GP4/GP5) avec la bibliothèque d'Adafruit : sur un processeur
// 32 bits, l'API d'ST garde le débit du signal entier (int de 32 bits) ; mêmes mesures que sur l'Uno.
#include <Adafruit_VL53L0X.h>
Adafruit_VL53L0X lox = Adafruit_VL53L0X();
void setup() {
  Serial.begin(115200);
  delay(100);
  if (!lox.begin()) { Serial.println("Echec VL53L0X"); while (1); }
  Serial.println("VL53L0X ok");
}
void loop() {
  VL53L0X_RangingMeasurementData_t mesure;
  lox.rangingTest(&mesure, false);
  Serial.print("mm="); Serial.print(mesure.RangeMilliMeter); Serial.print(" st="); Serial.println(mesure.RangeStatus);
  delay(100);
}
