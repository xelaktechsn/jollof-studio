// expect: len=4096
// expect: e0=17 e1024=34 e4095=51 vide=255
// expect: mesure=3000:21.50:ok
// run-ms: 400
// EEPROM de 4 Ko : adresses au-delà de 1 Ko (pas de repli sur l'adresse 0 comme sur l'Uno), put/get d'une structure.
#include <EEPROM.h>
struct Mesure { int id; float t; char tag[3]; };
void setup() {
  Serial.begin(9600);
  Serial.print("len="); Serial.println(EEPROM.length());
  EEPROM.write(0, 17); EEPROM.write(1024, 34); EEPROM.write(4095, 51);
  Serial.print("e0="); Serial.print(EEPROM.read(0)); Serial.print(" e1024="); Serial.print(EEPROM.read(1024));
  Serial.print(" e4095="); Serial.print(EEPROM.read(4095)); Serial.print(" vide="); Serial.println(EEPROM.read(2000));
  Mesure m = { 3000, 21.5, "ok" }, r;
  EEPROM.put(3000, m); EEPROM.get(3000, r);
  Serial.print("mesure="); Serial.print(r.id); Serial.print(':'); Serial.print(r.t); Serial.print(':'); Serial.println(r.tag);
}
void loop() {}
