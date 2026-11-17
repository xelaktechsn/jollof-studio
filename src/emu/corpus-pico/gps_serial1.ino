// expect: POS 14.692
// expect: -17.446
// expect: alt=22.0
// module: {"type":"neo6m","pins":{"TX":"GP1","RX":"GP0"},"inp":{"gpsCold":0}}
// run-ms: 2300
// GPS NEO-6M sur Serial1 du Pico (TX du module sur GP1, RX de l'UART0) et TinyGPSPlus.
#include <TinyGPSPlus.h>
TinyGPSPlus gps;
void setup() { Serial.begin(115200); Serial1.begin(9600); }
void loop() {
  while (Serial1.available()) {
    if (gps.encode(Serial1.read()) && gps.location.isUpdated()) {
      Serial.print("POS "); Serial.print(gps.location.lat(), 6); Serial.print(' '); Serial.println(gps.location.lng(), 6);
      Serial.print("alt="); Serial.println(gps.altitude.meters(), 1);
    }
  }
}
