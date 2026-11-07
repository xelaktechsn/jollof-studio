// expect: shown
// module: {"type":"ws2812","pins":{"DIN":"GP6"}}
// px: GP6 255,0,0 0,255,0 0,0,255
// run-ms: 150
// Barrette WS2812B pilotée par Adafruit_NeoPixel : sur le Pico, le signal à 800 kHz sort d'une machine PIO,
// dont les attentes [delay] et le diviseur d'horloge sont respectés au cycle près.
#include <Adafruit_NeoPixel.h>
Adafruit_NeoPixel leds(3, 6, NEO_GRB + NEO_KHZ800);
void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);
  leds.begin();
  leds.setPixelColor(0, leds.Color(255, 0, 0));
  leds.setPixelColor(1, leds.Color(0, 255, 0));
  leds.setPixelColor(2, leds.Color(0, 0, 255));
  leds.show();
  Serial.println("shown");
}
void loop() {}
