// module: {"type":"lcd2004","addr":[39]}
// screen: {"type":"lcd2004","lines":["Jollof Studio","","  ligne 3","Quatrieme ligne 20c"]}
// run-ms: 1800
// Écran LCD 20 × 4 et son adaptateur I2C (PCF8574 à 0x27), bibliothèque LiquidCrystal_I2C : lignes 3 et 4 aux
// adresses 0x14 et 0x54 du HD44780.
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 20, 4);
void setup() {
  lcd.init();
  lcd.backlight();
  lcd.print("Jollof Studio");
  lcd.setCursor(2, 2); lcd.print("ligne 3");
  lcd.setCursor(0, 3); lcd.print("Quatrieme ligne 20c");
}
void loop() {}
