// expect: done
// module: {"type":"st7735","pins":{"CS":"D7","DC":"D6","RESET":"D5","SDA":"D4","SCK":"D3"}}
// tft: {"type":"st7735","on":true,"px":[[0,0,"#ff00ff"],[3,3,"#ff00ff"],[4,4,"#000000"],[126,1,"#00ffff"]]}
// run-ms: 2500
// ST7735 en SPI logiciel (Adafruit_ST7735(cs, dc, mosi, sclk, rst)) : chaque bit passe par les broches de la carte,
// l'écran les lit aux fronts montants de SCK.
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
Adafruit_ST7735 tft = Adafruit_ST7735(7, 6, 4, 3, 5);
void setup() {
  Serial.begin(9600);
  tft.initR(INITR_BLACKTAB);
  tft.fillRect(0, 0, 4, 4, ST77XX_MAGENTA);
  tft.fillRect(4, 4, 1, 1, ST77XX_BLACK);
  tft.drawPixel(126, 1, ST77XX_CYAN);
  Serial.println(F("done"));
}
void loop() {}
