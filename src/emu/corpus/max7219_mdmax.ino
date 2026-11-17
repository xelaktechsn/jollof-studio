// module: {"type":"max7219m","pins":{"DIN":"D11","CLK":"D13","CS":"D10"}}
// screen: {"type":"max7219m","on":true,"mat":[1,0,128,0,0,0,0,0]}
// expect: cols=8
// run-ms: 400
// Matrice MAX7219 pilotée par MD_MAX72XX (MajicDesigns) en SPI matériel (MOSI D11, SCK D13, CS D10), module FC-16 :
// la colonne 0 est à droite.
#include <MD_MAX72xx.h>
#include <SPI.h>
MD_MAX72XX mx = MD_MAX72XX(MD_MAX72XX::FC16_HW, 10, 1);
void setup() {
  Serial.begin(9600);
  mx.begin();
  mx.control(MD_MAX72XX::INTENSITY, 2);
  mx.clear();
  mx.setPoint(0, 0, true);
  mx.setPoint(2, 7, true);
  Serial.print(F("cols=")); Serial.println(mx.getColumnCount());
}
void loop() {}
