// expect: bright
// module: {"type":"ws2812","pins":{"DIN":"D6"}}
// setBrightness() appliqué par la bibliothèque avant l'envoi, plusieurs trames de suite dans la même tranche de
// simulation (la dernière reste affichée), fill() et setPixelColor(i, r, g, b). Couleurs contrôlées par
// src/emu/devices/pinio.test.mjs, qui les compare à celles de l'interpréteur.
#include <Adafruit_NeoPixel.h>
Adafruit_NeoPixel leds(8, 6, NEO_GRB + NEO_KHZ800);
void setup() {
  Serial.begin(115200);
  leds.begin();
  leds.setBrightness(50);
  for (int k = 0; k < 5; k++) {
    leds.clear();
    leds.setPixelColor(k, leds.Color(255, 128, 10));
    leds.show();
  }
  leds.fill(leds.Color(0, 0, 200), 5, 2);
  leds.setPixelColor(7, 100, 200, 30);
  leds.show();
  Serial.println("bright");
}
void loop() {}
