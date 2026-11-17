// expect: POS 14.69
// expect: -17.44
// expect: km/h=36.0
// not-expect: KO
// module: {"type":"neo6m","pins":{"TX":"D19","RX":"D18"},"inp":{"gpsCold":0,"gpsSpeed":36,"gpsCourse":45}}
// run-ms: 2300
// GPS NEO-6M sur le port série matériel Serial1 du Mega (TX du module sur RX1 = D19) et TinyGPSPlus ; le véhicule
// roule à 36 km/h vers le nord-est.
#include <TinyGPSPlus.h>
TinyGPSPlus gps;
void setup() { Serial.begin(115200); Serial1.begin(9600); }
void loop() {
  while (Serial1.available()) {
    if (gps.encode(Serial1.read()) && gps.location.isUpdated() && gps.speed.isValid()) {
      Serial.print(F("POS ")); Serial.print(gps.location.lat(), 5); Serial.print(' '); Serial.println(gps.location.lng(), 5);
      Serial.print(F("km/h=")); Serial.println(gps.speed.kmph(), 1);
      if (gps.course.deg() < 44 || gps.course.deg() > 46) Serial.println(F("KO cap"));
    }
  }
}
