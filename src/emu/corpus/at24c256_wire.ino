// module: {"type":"at24c256","addr":[80],"mem":{"ee":"48656c6c6f"}}
// expect: old=Hello
// expect: busy=2
// expect: polls>0
// expect: page=2,3,4,5|60,61
// run-ms: 400
// Mémoire EEPROM AT24C256 par Wire, sans bibliothèque : contenu gardé avec le projet (« Hello »), écriture d'une page
// de 64 octets dont l'adresse fait le tour, adresse non acquittée pendant le cycle d'écriture (interrogation).
#include <Wire.h>
void setAddr(unsigned int a) { Wire.beginTransmission(0x50); Wire.write(a >> 8); Wire.write(a & 0xFF); }
void setup() {
  Serial.begin(9600); Wire.begin();
  setAddr(0); Wire.endTransmission();
  Wire.requestFrom(0x50, 5);
  Serial.print(F("old="));
  while (Wire.available()) Serial.write(Wire.read());
  Serial.println();
  setAddr(126); // deux octets avant la fin de la page 1 : les suivants reviennent à l'adresse 64
  for (byte i = 0; i < 6; i++) Wire.write(60 + i);
  Wire.endTransmission();
  Wire.beginTransmission(0x50);
  Serial.print(F("busy=")); Serial.println(Wire.endTransmission());
  int polls = 0;
  do { Wire.beginTransmission(0x50); polls++; } while (Wire.endTransmission() != 0 && polls < 1000);
  Serial.print(F("polls>")); Serial.println(polls > 1 ? 0 : -1);
  setAddr(64); Wire.endTransmission();
  Wire.requestFrom(0x50, 4);
  Serial.print(F("page="));
  for (int i = 0; i < 4; i++) { Serial.print(Wire.read() - 60); Serial.print(i < 3 ? ',' : '|'); }
  setAddr(126); Wire.endTransmission();
  Wire.requestFrom(0x50, 2);
  Serial.print(Wire.read()); Serial.print(','); Serial.println(Wire.read());
}
void loop() {}
