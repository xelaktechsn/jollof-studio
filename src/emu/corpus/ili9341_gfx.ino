// expect: mode=9C
// expect: madctl=48
// module: {"type":"ili9341","pins":{"CS":"D10","DC":"D9","RESET":"D8","MOSI":"D11","SCK":"D13","MISO":"D12"}}
// tft: {"type":"ili9341","on":true,"px":[[0,0,"#00ff00"],[2,2,"#00ff00"],[3,3,"#000000"],[239,0,"#ff0000"],[120,130,"#ffffff"]]}
// run-ms: 2500
// Écran TFT 2,8" ILI9341 en SPI matériel, bibliothèque Adafruit ILI9341 : lectures de diagnostic sur MISO (RDMODE,
// MADCTL), rotation 0 et 1 au bon coin, cercle tracé.
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <SPI.h>
Adafruit_ILI9341 tft = Adafruit_ILI9341(10, 9, 8);
void setup() {
  Serial.begin(9600);
  tft.begin();
  Serial.print(F("mode=")); Serial.println(tft.readcommand8(ILI9341_RDMODE), HEX);
  Serial.print(F("madctl=")); Serial.println(tft.readcommand8(ILI9341_RDMADCTL), HEX);
  tft.fillScreen(ILI9341_BLACK);
  tft.fillRect(0, 0, 3, 3, ILI9341_GREEN);
  tft.drawCircle(120, 160, 30, ILI9341_WHITE);
  tft.setRotation(1);
  tft.drawPixel(0, 0, ILI9341_RED);
}
void loop() {}
