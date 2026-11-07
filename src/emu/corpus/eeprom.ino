// expect: fresh=255 stored=42 word=1234
#include <EEPROM.h>
void setup() {
  Serial.begin(9600);
  Serial.print("fresh="); Serial.print(EEPROM.read(10));
  EEPROM.write(10, 42);
  Serial.print(" stored="); Serial.print(EEPROM.read(10));
  int w = 1234; EEPROM.put(20, w); int r = 0; EEPROM.get(20, r);
  Serial.print(" word="); Serial.println(r);
}
void loop() {}
