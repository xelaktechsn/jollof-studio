// Encodeur KY-040 lu par la bibliothèque Encoder (Paul Stoffregen) : CLK sur D2, DT sur D3 (deux interruptions),
// bouton SW sur D4. Trois crans dans le sens horaire puis un dans l'autre sens : 4 fronts par cran.
// Encoder(DT, CLK) : le sens horaire compte en positif.
// module: {"type":"ky040","pins":{"CLK":"D2","DT":"D3","SW":"D4"}}
// event: 200 encTurn ky040 [1, 3]
// event: 500 encTurn ky040 [-1, 1]
// event: 700 encPress ky040 [true]
// run-ms: 900
// expect: pos=12
// expect: pos=8
// expect: SW
// not-expect: pos=-
#include <Encoder.h>
Encoder molette(3, 2);
long avant = 0;
void setup() {
  Serial.begin(115200);
  pinMode(4, INPUT_PULLUP);
  Serial.println("pret");
}
void loop() {
  long p = molette.read();
  if (p != avant) { avant = p; if (p % 4 == 0) { Serial.print("pos="); Serial.println(p); } }
  if (digitalRead(4) == LOW) { Serial.println("SW"); delay(300); }
}
