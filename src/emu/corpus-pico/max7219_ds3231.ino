// module: {"type":"max7219m","pins":{"DIN":"GP3","CLK":"GP2","CS":"GP6"}}
// module: {"type":"tm1637","pins":{"CLK":"GP14","DIO":"GP15"}}
// module: {"type":"ds3231","addr":[104,87]}
// screen: {"type":"max7219m","on":true,"mat":[255,129,0,0,0,0,0,24]}
// screen: {"type":"tm1637","on":true,"text":"09:30"}
// expect: rtc=1
// run-ms: 1200
// Pico : matrice MAX7219 (LedControl sur GP2, GP3, GP6), TM1637 (GP14, GP15) et horloge DS3231 (I2C0 sur GP4/GP5).
#include <Wire.h>
#include <RTClib.h>
#include <LedControl.h>
#include <TM1637Display.h>
LedControl lc(3, 2, 6, 1);
TM1637Display disp(14, 15);
RTC_DS3231 rtc;
void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);
  Wire.begin();
  Serial.print("rtc="); Serial.println(rtc.begin());
  rtc.adjust(DateTime(2026, 1, 1, 9, 30, 0));
  lc.shutdown(0, false); lc.setIntensity(0, 15); lc.clearDisplay(0);
  lc.setRow(0, 0, 0xFF); lc.setRow(0, 1, 0x81); lc.setRow(0, 7, 0x18);
  disp.setBrightness(3);
}
void loop() {
  DateTime t = rtc.now();
  disp.showNumberDecEx(t.hour() * 100 + t.minute(), 0x40, true);
  delay(200);
}
