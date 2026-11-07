// expect: lcd-ok
// lcd: Bonjour Dakar!|T=21.5 C°
// run-ms: 1500
// Écran LCD 16×2 I2C (adresse 0x27) avec la vraie bibliothèque LiquidCrystal_I2C.
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);
void setup() {
  Serial.begin(9600);
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0); lcd.print("Bonjour Dakar!");
  lcd.setCursor(0, 1); lcd.print("T="); lcd.print(21.5, 1); lcd.print(" C"); lcd.write(0xDF);
  Serial.println("lcd-ok");
}
void loop() {}
