// expect: pcf-ok p7=0 p6=1
// module: {"type":"pcf8574","addr":[32],"levels":{"P7":0}}
// chip-out: {"type":"pcf8574","P0":0,"P1":1}
// Extenseur PCF8574 avec la bibliothèque de Rob Tillaart : P0 à 0 (LED vers VCC allumée), P7 lu tiré à la masse.
#include <PCF8574.h>
PCF8574 pcf(0x20);
void setup() {
  Serial.begin(9600);
  Wire.begin();
  if (!pcf.begin()) { Serial.println("pcf-absent"); return; }
  pcf.write(0, LOW);
  Serial.print("pcf-ok p7="); Serial.print(pcf.read(7)); Serial.print(" p6="); Serial.println(pcf.read(6));
}
void loop() {}
