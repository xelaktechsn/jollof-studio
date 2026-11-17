// expect: pas de position
// expect: POS 14.69
// expect: -17.44
// expect: sats=8
// expect: date=
// not-expect: erreurs=1
// module: {"type":"neo6m","pins":{"TX":"D4","RX":"D3"},"inp":{"gpsCold":2}}
// run-ms: 3300
// GPS NEO-6M sur SoftwareSerial (TX du module sur D4) et TinyGPSPlus : trames NMEA à 9600 bauds, une salve par seconde ;
// démarrage à froid réglé à 2 s sur le module : la première salve n'a pas de position, les suivantes ont celle de Dakar.
#include <TinyGPSPlus.h>
#include <SoftwareSerial.h>
TinyGPSPlus gps;
SoftwareSerial ss(4, 3); // RX, TX
bool dit = false;
void setup() { Serial.begin(115200); ss.begin(9600); }
void loop() {
  while (ss.available() > 0) {
    if (!gps.encode(ss.read())) continue;
    if (gps.location.isUpdated()) {
      Serial.print(F("POS ")); Serial.print(gps.location.lat(), 6); Serial.print(' '); Serial.println(gps.location.lng(), 6);
      Serial.print(F("sats=")); Serial.print(gps.satellites.value());
      Serial.print(F(" date=")); Serial.print(gps.date.day()); Serial.print('/'); Serial.println(gps.date.month());
      if (gps.failedChecksum()) Serial.println(F("erreurs=1"));
    } else if (!dit && gps.charsProcessed() > 50 && !gps.location.isValid()) { dit = true; Serial.println(F("pas de position")); }
  }
}
