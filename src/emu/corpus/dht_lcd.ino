// expect: shown
// module: {"type":"dht22","pins":{"DATA":"D4"},"data":{"temp":28.3,"hum":72}}
// input: {"D4":{"d":1}}
// lcd: Temp: 28.3 C|Hum : 72 %
// run-ms: 3500
// Station météo de poche : DHT22 (signal temporisé sur D4) affiché sur l'écran LCD I2C, deux modules ensemble.
#include <DHT.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
DHT dht(4, DHT22);
LiquidCrystal_I2C lcd(0x27, 16, 2);
bool done = false;
void setup() { Serial.begin(9600); dht.begin(); lcd.init(); lcd.backlight(); }
void loop() {
  if (done || millis() < 2200) return;
  float t = dht.readTemperature(), h = dht.readHumidity();
  if (isnan(t) || isnan(h)) return;
  lcd.setCursor(0, 0); lcd.print("Temp: "); lcd.print(t, 1); lcd.print(" C");
  lcd.setCursor(0, 1); lcd.print("Hum : "); lcd.print(h, 0); lcd.print(" %");
  Serial.println("shown");
  done = true;
}
