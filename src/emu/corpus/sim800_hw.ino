// expect: [AT+CSQ|+CSQ: 20,0|OK]
// expect: [AT+CREG?|+CREG: 0,1|OK]
// module: {"type":"sim800","pins":{"TXD":"D0","RXD":"D1"}}
// run-ms: 1200
// SIM800L sur le port série matériel (D1, TX de la carte, vers RXD ; TXD du module vers D0, RX) : ce que
// la carte envoie part aussi vers le moniteur série ; la réponse du module, reçue par Serial, y est recopiée entre [ ].
void commande(const char *c) {
  Serial.println(c);
  unsigned long t = millis();
  String r = "", ligne = "";
  while (millis() - t < 150) {
    while (Serial.available()) {
      char ch = Serial.read();
      if (ch != '\r' && ch != '\n') { ligne += ch; continue; }
      if (ligne.length()) { if (r.length()) r += "|"; r += ligne; ligne = ""; }
    }
  }
  Serial.print("["); Serial.print(r); Serial.println("]");
  delay(250);
  while (Serial.available()) Serial.read(); // réponse du module à la ligne entre crochets (ERROR) : ignorée
}
void setup() {
  Serial.begin(9600);
  commande("AT+CSQ");
  commande("AT+CREG?");
}
void loop() {}
