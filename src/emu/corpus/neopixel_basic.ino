// expect: shown
// module: {"type":"ws2812","pins":{"DIN":"D6"}}
// Barrette WS2812B pilotée par la vraie bibliothèque Adafruit_NeoPixel (signal à 800 kHz compté en cycles, sans
// interruption). Le contrôle des couleurs reçues par les LED est fait par src/emu/devices/pinio.test.mjs.
#include <Adafruit_NeoPixel.h>
Adafruit_NeoPixel leds(8, 6, NEO_GRB + NEO_KHZ800);
void setup() {
  Serial.begin(115200);
  leds.begin();
  leds.setPixelColor(0, leds.Color(255, 0, 0));
  leds.setPixelColor(1, leds.Color(0, 255, 0));
  leds.setPixelColor(2, leds.Color(0, 0, 255));
  leds.setPixelColor(7, leds.Color(12, 34, 56));
  leds.show();
  Serial.println("shown");
}
void loop() {}
