// expect: [OK]
// expect: [+NAME:HC-05]
// expect: [+UART:9600,0,0]
// expect: [+VERSION:2.0-20100601]
// module: {"type":"hc05","pins":{"TXD":"D10","RXD":"D11","EN":"D9"}}
// run-ms: 1200
// HC-05 en mode commandes AT : EN (KEY) à HIGH avant d'ouvrir la liaison, SoftwareSerial à 38400 bauds sur D10/D11.
// Chaque réponse du module est recopiée entre crochets sur le moniteur série.
#include <SoftwareSerial.h>
SoftwareSerial bt(10, 11); // RX, TX
void commande(const char *c) {
  bt.println(c);
  unsigned long t = millis();
  String r = "";
  while (millis() - t < 150) {
    while (bt.available()) {
      char ch = bt.read();
      if (ch == '\n') { Serial.print("["); Serial.print(r); Serial.println("]"); r = ""; }
      else if (ch != '\r') r += ch;
    }
  }
}
void setup() {
  pinMode(9, OUTPUT);
  digitalWrite(9, HIGH);
  Serial.begin(115200);
  bt.begin(38400);
  commande("AT");
  commande("AT+NAME?");
  commande("AT+UART?");
  commande("AT+VERSION?");
}
void loop() {}
