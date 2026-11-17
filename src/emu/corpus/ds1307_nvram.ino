// module: {"type":"ds1307","addr":[104]}
// expect: running=1
// expect: nv=42,43
// expect: 12:00:05
// run-ms: 5600
// Horloge DS1307 avec RTClib : isrunning(), RAM sauvegardée (56 octets à partir de 0x08), heure qui avance.
#include <Wire.h>
#include <RTClib.h>
RTC_DS1307 rtc;
void setup() {
  Serial.begin(9600);
  rtc.begin();
  Serial.print(F("running=")); Serial.println(rtc.isrunning());
  rtc.writenvram(3, 42); rtc.writenvram(55, 43);
  Serial.print(F("nv=")); Serial.print(rtc.readnvram(3)); Serial.print(','); Serial.println(rtc.readnvram(55));
  rtc.adjust(DateTime(2026, 11, 17, 12, 0, 0));
  delay(5200);
  DateTime t = rtc.now();
  char b[12]; sprintf(b, "%02d:%02d:%02d", t.hour(), t.minute(), t.second()); Serial.println(b);
}
void loop() {}
