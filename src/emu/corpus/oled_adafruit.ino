// expect: begin=1
// expect: st=0
// expect: off=64
// expect: on=0
// module: {"type":"oled","addr":[60]}
// run-ms: 1000
// Écran OLED 128×64 (0x3C) avec les vraies bibliothèques Adafruit SSD1306 et GFX ; l'octet d'état lu sur le bus
// dit si l'affichage est allumé (bit 6 à 0) : sans écran branché, la lecture ne rendrait rien (255).
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
Adafruit_SSD1306 display(128, 64, &Wire, -1);
byte status() { Wire.requestFrom((uint8_t)0x3C, (uint8_t)1); return Wire.read(); }
void setup() {
  Serial.begin(9600);
  Serial.print(F("begin=")); Serial.println(display.begin(SSD1306_SWITCHCAPVCC, 0x3C));
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0); display.println(F("Jollof"));
  display.drawRect(0, 16, 128, 48, SSD1306_WHITE);
  display.display();
  Serial.print(F("st=")); Serial.println(status());
  display.ssd1306_command(SSD1306_DISPLAYOFF);
  Serial.print(F("off=")); Serial.println(status());
  display.ssd1306_command(SSD1306_DISPLAYON);
  Serial.print(F("on=")); Serial.println(status());
}
void loop() {}
