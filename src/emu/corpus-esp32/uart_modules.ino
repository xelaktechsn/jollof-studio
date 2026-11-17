// expect: [OK]
// expect: [+NAME:HC-05]
// expect: [+VERSION:2.0-20100601]
// expect: pas de position
// expect: POS 14.69
// expect: -17.44
// expect: sats=8
// module: {"type":"hc05","pins":{"TXD":"RX2","RXD":"TX2","EN":"D4"}}
// module: {"type":"neo6m","pins":{"TX":"D26","RX":"D27"},"inp":{"gpsCold":8}}
// run-ms: 16000
// Ports série de l'ESP32 dans QEMU : Bluetooth HC-05 en mode AT (EN à HIGH, 38400 bauds) sur Serial2 (RX 16, TX 17),
// GPS NEO-6M sur Serial1 (RX 26, TX 27) lu par TinyGPSPlus : démarrage à froid, puis la position de Dakar.
#include <TinyGPSPlus.h>
TinyGPSPlus gps;
bool dit = false;
void commande(const char *c) {
  Serial2.println(c);
  unsigned long t = millis();
  String r = "";
  while (millis() - t < 300) {
    while (Serial2.available()) {
      char ch = Serial2.read();
      if (ch == '\n') { Serial.print("["); Serial.print(r); Serial.println("]"); r = ""; }
      else if (ch != '\r') r += ch;
    }
  }
}
void setup() {
  Serial.begin(115200);
  Serial1.begin(9600, SERIAL_8N1, 26, 27);
  pinMode(4, OUTPUT);
  digitalWrite(4, HIGH);
  Serial2.begin(38400, SERIAL_8N1, 16, 17);
  commande("AT");
  commande("AT+NAME?");
  commande("AT+VERSION?");
}
void loop() {
  while (Serial1.available() > 0) {
    if (!gps.encode(Serial1.read())) continue;
    if (gps.location.isUpdated()) {
      Serial.print("POS "); Serial.print(gps.location.lat(), 6); Serial.print(' '); Serial.println(gps.location.lng(), 6);
      Serial.print("sats="); Serial.println(gps.satellites.value());
    } else if (!dit && gps.charsProcessed() > 50 && !gps.location.isValid()) { dit = true; Serial.println("pas de position"); }
  }
}
