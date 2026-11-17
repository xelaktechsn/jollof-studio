// module: {"type":"max7219s","pins":{"DIN":"D7","CLK":"D6","CS":"D5"}}
// screen: {"type":"max7219s","on":true,"text":"-H2.7"}
// run-ms: 300
// Afficheur MAX7219 à 8 chiffres de 7 segments avec LedControl : setDigit (chiffre 0 à droite) et setChar.
#include <LedControl.h>
LedControl lc = LedControl(7, 6, 5, 1);
void setup() {
  lc.shutdown(0, false);
  lc.setIntensity(0, 4);
  lc.clearDisplay(0);
  lc.setDigit(0, 0, 7, false);
  lc.setDigit(0, 1, 2, true);
  lc.setChar(0, 2, 'H', false);
  lc.setChar(0, 3, '-', false);
}
void loop() {}
