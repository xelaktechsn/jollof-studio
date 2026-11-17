// expect: cols=8
// expect: compteur=4
// expect: compteur=-2
// module: {"type":"max7219m","pins":{"DIN":"D23","CLK":"D18","CS":"D5"}}
// module: {"type":"ky040","pins":{"CLK":"D34","DT":"D35"}}
// screen: {"type":"max7219m","on":true,"mat":[1,0,128,0,0,0,0,0]}
// event: 2500 encTurn ky040 [1, 2]
// event: 3500 encTurn ky040 [-1, 3]
// run-ms: 9000
// Sur l'ESP32 dans QEMU : matrice MAX7219 (MD_MAX72XX en SPI matériel, module FC-16 : la colonne 0 est à droite ;
// LedControl ne compile pas pour l'ESP32), codeur KY-040 lu par interruption sur CLK (deux fronts de CLK par cran).
#include <MD_MAX72xx.h>
#include <SPI.h>
MD_MAX72XX mx = MD_MAX72XX(MD_MAX72XX::FC16_HW, 5, 1);
volatile int compteur = 0;
int montre = 0;
void IRAM_ATTR tourne() { if (digitalRead(35) != digitalRead(34)) compteur++; else compteur--; }
void setup() {
  Serial.begin(115200);
  mx.begin();
  mx.control(MD_MAX72XX::INTENSITY, 2);
  mx.clear();
  mx.setPoint(0, 0, true);
  mx.setPoint(2, 7, true);
  Serial.print("cols="); Serial.println(mx.getColumnCount());
  pinMode(34, INPUT); pinMode(35, INPUT);
  attachInterrupt(digitalPinToInterrupt(34), tourne, CHANGE);
}
void loop() {
  noInterrupts(); int c = compteur; interrupts();
  if (c != montre) { montre = c; Serial.print("compteur="); Serial.println(c); }
}
