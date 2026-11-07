// expect: cmd=0x45 addr=0x0 raw=BA45FF00 NEC
// expect: cmd=0x15 addr=0x0 raw=EA15FF00 NEC
// expect: R cmd=0x15
// not-expect: R cmd=0x45
// module: {"type":"ir","pins":{"OUT":"D2"}}
// event: 300 irPress ir [69]
// event: 600 irPress ir [21]
// event: 610 irPress ir [21,true]
// run-ms: 1000
// Récepteur infrarouge lu par la vraie bibliothèque IRremote 4 (Timer2, un échantillon toutes les 50 µs) :
// deux touches de la télécommande NEC, puis une trame de répétition (touche maintenue).
#include <IRremote.hpp>
void setup() {
  Serial.begin(115200);
  IrReceiver.begin(2, DISABLE_LED_FEEDBACK);
  Serial.println("pret");
}
void loop() {
  if (IrReceiver.decode()) {
    IRData &d = IrReceiver.decodedIRData;
    if (d.flags & IRDATA_FLAGS_IS_REPEAT) Serial.print("R ");
    Serial.print("cmd=0x"); Serial.print(d.command, HEX);
    Serial.print(" addr=0x"); Serial.print(d.address, HEX);
    if (!(d.flags & IRDATA_FLAGS_IS_REPEAT)) { Serial.print(" raw="); Serial.print((uint32_t)d.decodedRawData, HEX); }
    if (d.protocol == NEC) Serial.print(" NEC");
    Serial.println();
    IrReceiver.resume();
  }
}
