// expect: saved
// expect: name=Dakar temp=31.50 count=7
// Une structure entière dans l'EEPROM avec put() et get(), comme un réglage gardé entre deux mises sous tension.
#include <EEPROM.h>
struct Reglage { char name[8]; float temp; unsigned int count; };
void setup() {
  Serial.begin(9600);
  Reglage a = { "Dakar", 31.5, 7 };
  EEPROM.put(16, a);
  Serial.println("saved");
  Reglage b;
  EEPROM.get(16, b);
  Serial.print("name="); Serial.print(b.name);
  Serial.print(" temp="); Serial.print(b.temp, 2);
  Serial.print(" count="); Serial.println(b.count);
}
void loop() {}
