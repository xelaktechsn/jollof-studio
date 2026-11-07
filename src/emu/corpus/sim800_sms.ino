// expect: <AT|OK>
// expect: <ATE0|OK>
// expect: <+CSQ: 20,0|OK>
// expect: <+CMGF: 1|OK>
// expect: <> >
// expect: <+CMGS: 1|OK>
// module: {"type":"sim800","pins":{"TXD":"D7","RXD":"D8"}}
// run-ms: 2500
// Module GSM SIM800L par SoftwareSerial (D7, D8) : il se cale sur la vitesse du premier « AT », répond aux commandes
// avec écho (ATE0 le coupe), puis envoie un SMS en mode texte (AT+CMGF=1, AT+CMGS, texte, Ctrl+Z). Les lignes reçues sont recopiées
// entre < >, séparées par |.
#include <SoftwareSerial.h>
SoftwareSerial sim(7, 8); // RX, TX
void lire(unsigned int ms) {
  unsigned long t = millis();
  String r = "", ligne = "";
  while (millis() - t < ms) {
    while (sim.available()) {
      char c = sim.read();
      if (c != '\r' && c != '\n') { ligne += c; continue; }
      if (ligne.length()) { if (r.length()) r += "|"; r += ligne; ligne = ""; }
    }
  }
  if (ligne.length()) { if (r.length()) r += "|"; r += ligne; }
  Serial.print("<"); Serial.print(r); Serial.println(">");
}
void setup() {
  Serial.begin(115200);
  sim.begin(9600);
  delay(100);
  sim.println("AT"); lire(200);
  sim.println("ATE0"); lire(200);
  sim.println("AT+CSQ"); lire(200);
  sim.println("AT+CMGF=1"); lire(200);
  sim.println("AT+CMGF?"); lire(200);
  sim.println("AT+CMGS=\"+221770000000\""); lire(200);
  sim.print("Bonjour depuis Jollof"); sim.write(26); lire(400);
}
void loop() {}
