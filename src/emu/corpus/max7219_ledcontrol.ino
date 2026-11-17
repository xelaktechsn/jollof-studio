// module: {"type":"max7219m","id":"m0","pins":{"DIN":"D12","CLK":"D11","CS":"D10"},"links":{"DOUT":[["m1","DIN"]]}}
// module: {"type":"max7219m","id":"m1","pins":{"CLK":"D11","CS":"D10"},"links":{"DIN":[["m0","DOUT"]]}}
// screen: {"id":"m0","on":true,"mat":[160,0,0,0,0,0,0,0]}
// screen: {"id":"m1","on":true,"mat":[128,128,0,0,0,0,0,1]}
// expect: devices=2
// run-ms: 400
// Deux matrices 8 × 8 MAX7219 en chaîne (DOUT du premier vers DIN du second, CLK et CS communs) avec la vraie
// bibliothèque LedControl : chaque mot traverse le premier module avant d'atteindre le second.
#include <LedControl.h>
LedControl lc = LedControl(12, 11, 10, 2);
void setup() {
  Serial.begin(9600);
  Serial.print(F("devices=")); Serial.println(lc.getDeviceCount());
  for (int i = 0; i < lc.getDeviceCount(); i++) { lc.shutdown(i, false); lc.setIntensity(i, 8); lc.clearDisplay(i); }
  lc.setRow(0, 0, B10100000);
  lc.setLed(1, 7, 7, true);
  lc.setColumn(1, 0, B11000000);
}
void loop() {}
