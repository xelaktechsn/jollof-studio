// expect: [OK]
// expect: [+NAME:HC-05]
// expect: [+UART:9600,0,0]
// module: {"type":"hc05","pins":{"TXD":"D19","RXD":"D18","EN":"D9"}}
// run-ms: 1000
// HC-05 en mode commandes AT sur Serial1 (TX1 = D18 vers RXD du module, RX1 = D19 depuis TXD), EN à HIGH : 38400 bauds.
void commande(const char *c) {
  Serial1.println(c);
  unsigned long t = millis();
  String r = "";
  while (millis() - t < 150) {
    while (Serial1.available()) {
      char ch = Serial1.read();
      if (ch == '\n') { Serial.print("["); Serial.print(r); Serial.println("]"); r = ""; }
      else if (ch != '\r') r += ch;
    }
  }
}
void setup() {
  pinMode(9, OUTPUT);
  digitalWrite(9, HIGH);
  Serial.begin(115200);
  Serial1.begin(38400);
  commande("AT");
  commande("AT+NAME?");
  commande("AT+UART?");
}
void loop() {}
