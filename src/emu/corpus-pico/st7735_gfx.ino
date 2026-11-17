// expect: init ok
// module: {"type":"st7735","pins":{"CS":"GP17","DC":"GP20","RESET":"GP21","SDA":"GP19","SCK":"GP18"}}
// tft: {"type":"st7735","on":true,"px":[[0,0,"#ff0000"],[9,9,"#ff0000"],[10,10,"#000000"],[127,0,"#0000ff"],[64,150,"#ffffff"]]}
// run-ms: 1500
// ST7735 sur le SPI0 matériel du Pico (GP18 SCK, GP19 MOSI), avec le cœur arduino-pico et les bibliothèques Adafruit.
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <SPI.h>
Adafruit_ST7735 tft = Adafruit_ST7735(17, 20, 21);
void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);
  tft.initR(INITR_BLACKTAB);
  tft.fillScreen(ST77XX_BLACK);
  tft.fillRect(0, 0, 10, 10, ST77XX_RED);
  tft.drawFastHLine(0, 150, 128, ST77XX_WHITE);
  tft.setRotation(1);
  tft.drawPixel(0, 0, ST77XX_BLUE);
  Serial.println("init ok");
}
void loop() {}
