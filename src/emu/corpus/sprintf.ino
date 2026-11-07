// expect: T=21.5 C, n=042, hex=FF
void setup() {
  Serial.begin(9600);
  char t[8], buf[48];
  dtostrf(21.5, 3, 1, t);
  sprintf(buf, "T=%s C, n=%03d, hex=%X", t, 42, 255);
  Serial.println(buf);
}
void loop() {}
