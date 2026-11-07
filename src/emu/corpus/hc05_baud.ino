// expect: recu=0
// module: {"type":"hc05","pins":{"TXD":"D10","RXD":"D11","EN":"D9"}}
// run-ms: 700
// HC-05 en mode AT (38400 bauds) mais SoftwareSerial réglé à 9600 : le module ne comprend pas la commande, et
// rien de lisible ne revient.
#include <SoftwareSerial.h>
SoftwareSerial bt(10, 11);
void setup() {
  pinMode(9, OUTPUT);
  digitalWrite(9, HIGH);
  Serial.begin(115200);
  bt.begin(9600);
  bt.println("AT");
  delay(300);
  int n = 0;
  while (bt.available()) { char c = bt.read(); if (c == 'O' || c == 'K') n++; }
  Serial.print("recu="); Serial.println(n);
}
void loop() {}
