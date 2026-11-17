// module: {"type":"at24c256","addr":[80]}
// expect: connected=1
// expect: size=32768
// expect: bad=0
// expect: struct=1234,-5.50
// run-ms: 500
// Mémoire AT24C256 avec la bibliothèque I2C_eeprom (Rob Tillaart) : bloc de 200 octets écrit à cheval sur des pages
// (la bibliothèque découpe et attend la fin de chaque cycle d'écriture), relu ; une structure entière.
#include <Wire.h>
#include <I2C_eeprom.h>
I2C_eeprom ee(0x50, I2C_DEVICESIZE_24LC256);
struct Mesure { int id; float v; };
void setup() {
  Serial.begin(9600);
  Wire.begin();
  ee.begin();
  Serial.print(F("connected=")); Serial.println(ee.isConnected());
  Serial.print(F("size=")); Serial.println(ee.getDeviceSize());
  uint8_t buf[200];
  for (int i = 0; i < 200; i++) buf[i] = i ^ 0x5A;
  ee.writeBlock(1000, buf, 200);
  memset(buf, 0, sizeof buf);
  ee.readBlock(1000, buf, 200);
  int bad = 0; for (int i = 0; i < 200; i++) if (buf[i] != (i ^ 0x5A)) bad++;
  Serial.print(F("bad=")); Serial.println(bad);
  Mesure m = { 1234, -5.5 };
  ee.writeBlock(20, (uint8_t *)&m, sizeof m);
  Mesure r;
  ee.readBlock(20, (uint8_t *)&r, sizeof r);
  Serial.print(F("struct=")); Serial.print(r.id); Serial.print(','); Serial.println(r.v);
}
void loop() {}
