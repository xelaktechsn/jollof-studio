// module: {"type":"ds3231","addr":[104,87],"data":{"temp":21.3}}
// expect: begin=1
// expect: lost=0
// expect: 2030/02/28 23:59:59
// expect: 2030/03/01 00:00:02 j=5
// expect: temp=21.25
// expect: alarm=1
// run-ms: 4200
// Horloge DS3231 (module ZS-042) avec RTClib : réglage de l'heure, passage à minuit et au mois suivant au rythme du
// temps simulé, température (pas de 0,25 °C), alarme 1 chaque seconde.
#include <Wire.h>
#include <RTClib.h>
RTC_DS3231 rtc;
void show(const DateTime &t) {
  char b[24];
  sprintf(b, "%04d/%02d/%02d %02d:%02d:%02d", t.year(), t.month(), t.day(), t.hour(), t.minute(), t.second());
  Serial.print(b);
}
void setup() {
  Serial.begin(9600);
  Serial.print(F("begin=")); Serial.println(rtc.begin());
  Serial.print(F("lost=")); Serial.println(rtc.lostPower());
  rtc.adjust(DateTime(2030, 2, 28, 23, 59, 59));
  show(rtc.now()); Serial.println();
  rtc.setAlarm1(DateTime(0, 0, 0, 0, 0, 0), DS3231_A1_PerSecond);
  rtc.clearAlarm(1);
  delay(3000);
  DateTime t = rtc.now();
  show(t); Serial.print(F(" j=")); Serial.println(t.dayOfTheWeek());
  Serial.print(F("temp=")); Serial.println(rtc.getTemperature());
  Serial.print(F("alarm=")); Serial.println(rtc.alarmFired(1));
}
void loop() {}
