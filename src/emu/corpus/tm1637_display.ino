// module: {"type":"tm1637","pins":{"CLK":"D2","DIO":"D3"}}
// screen: {"type":"tm1637","on":true,"text":"12:05"}
// run-ms: 300
// Afficheur TM1637 à 4 chiffres avec la bibliothèque TM1637Display (Avishay Orpaz) : protocole à deux fils décodé
// au front près, acquittement de la puce, deux-points (bit 7 du deuxième chiffre).
#include <TM1637Display.h>
TM1637Display display(2, 3);
void setup() {
  display.setBrightness(7);
  display.showNumberDec(42);
  delay(50);
  display.showNumberDecEx(1205, 0b01000000, true);
}
void loop() {}
