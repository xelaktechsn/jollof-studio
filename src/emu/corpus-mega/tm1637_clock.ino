// module: {"type":"tm1637","pins":{"CLK":"D30","DIO":"D31"}}
// module: {"type":"ds3231","addr":[104,87]}
// screen: {"type":"tm1637","on":true,"text":"08:00"}
// expect: ok
// run-ms: 1600
// Horloge du Mega : DS3231 (I2C sur D20/D21) lue chaque seconde, heures et minutes sur un TM1637 (D30, D31),
// deux-points allumé.
#include <Wire.h>
#include <RTClib.h>
#include <TM1637Display.h>
RTC_DS3231 rtc;
TM1637Display display(30, 31);
void setup() {
  Serial.begin(9600);
  if (rtc.begin()) Serial.println(F("ok"));
  rtc.adjust(DateTime(2026, 11, 17, 7, 59, 59));
  display.setBrightness(5);
}
void loop() {
  DateTime t = rtc.now();
  display.showNumberDecEx(t.hour() * 100 + t.minute(), 0b01000000, true);
  delay(500);
}
