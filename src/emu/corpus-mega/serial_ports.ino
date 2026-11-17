// expect: ECHO:BONJOUR
// expect: S1:ping1 S2:ping2 S3:ping3
// not-expect: ping1\r\n
// send: bonjour\n
// loopback: Serial1
// loopback: Serial2
// loopback: Serial3
// run-ms: 600
// Les quatre ports série du Mega : Serial (moniteur), et Serial1 à Serial3 bouclés (fil de TX à RX) à des vitesses
// différentes. Ce qui part sur Serial1 à 3 ne s'affiche pas sur le moniteur série.
String back(HardwareSerial &s, const char *msg) {
  s.print(msg);
  unsigned long t = millis();
  String r;
  while (millis() - t < 50) while (s.available()) r += (char)s.read();
  return r;
}
void setup() {
  Serial.begin(115200); Serial1.begin(9600); Serial2.begin(57600); Serial3.begin(115200);
  String a = back(Serial1, "ping1\r\n"), b = back(Serial2, "ping2"), c = back(Serial3, "ping3");
  a.trim();
  Serial.print("S1:"); Serial.print(a); Serial.print(" S2:"); Serial.print(b); Serial.print(" S3:"); Serial.println(c);
}
void loop() {
  if (Serial.available()) {
    String s = Serial.readStringUntil('\n');
    s.toUpperCase();
    Serial.print("ECHO:"); Serial.println(s);
  }
}
