// expect: init ok
// expect: w=160 h=128
// module: {"type":"st7735","pins":{"CS":"D10","DC":"D9","RESET":"D8","SDA":"D11","SCK":"D13"}}
// tft: {"type":"st7735","on":true,"px":[[0,0,"#ff0000"],[9,9,"#ff0000"],[10,10,"#000000"],[127,0,"#0000ff"],[127,159,"#00ff00"],[0,159,"#ffffff"],[60,80,"#ffff00"]]}
// run-ms: 1500
// Écran TFT 1,8" ST7735 (black tab) en SPI matériel, bibliothèques Adafruit ST7735 et GFX : le pixel (0, 0) de chaque
// rotation tombe au coin attendu de la dalle, les couleurs RGB565 arrivent telles quelles.
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <SPI.h>
Adafruit_ST7735 tft = Adafruit_ST7735(10, 9, 8);
void setup() {
  Serial.begin(9600);
  tft.initR(INITR_BLACKTAB);
  Serial.println(F("init ok"));
  tft.fillScreen(ST77XX_BLACK);
  tft.fillRect(0, 0, 10, 10, ST77XX_RED);
  tft.fillCircle(60, 80, 6, ST77XX_YELLOW);
  tft.setCursor(20, 120); tft.setTextColor(ST77XX_WHITE); tft.print(F("Jollof"));
  tft.setRotation(1);
  Serial.print(F("w=")); Serial.print(tft.width()); Serial.print(F(" h=")); Serial.println(tft.height());
  tft.drawPixel(0, 0, ST77XX_BLUE);
  tft.setRotation(2); tft.drawPixel(0, 0, ST77XX_GREEN);
  tft.setRotation(3); tft.drawPixel(0, 0, ST77XX_WHITE);
}
void loop() {}
