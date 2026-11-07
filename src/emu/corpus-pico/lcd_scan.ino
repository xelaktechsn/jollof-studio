// expect: found 0x27
// not-expect: found 0x3C
// lcd: Bonjour|Pico GP4/GP5
// run-ms: 1300
// Scanner I2C puis écran LCD I2C (LiquidCrystal_I2C). Wire.endTransmission() sans octet : le cœur arduino-pico
// sonde l'adresse en pilotant lui-même SDA et SCL (pas le contrôleur I2C) ; l'émulateur répond à ce niveau-là.
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);
void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);
  Wire.begin();
  for (int a = 8; a < 120; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) { Serial.print("found 0x"); Serial.println(a, HEX); }
  }
  lcd.init();
  lcd.backlight();
  lcd.print("Bonjour");
  lcd.setCursor(0, 1);
  lcd.print("Pico GP4/GP5");
}
void loop() {}
