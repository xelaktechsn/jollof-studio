// expect: toggles=10
// run-ms: 1100
unsigned long last = 0;
int toggles = 0;
void setup() { Serial.begin(9600); pinMode(13, OUTPUT); }
void loop() {
  if (millis() - last >= 100 && toggles < 10) {
    last = millis();
    digitalWrite(13, !digitalRead(13));
    if (++toggles == 10) { Serial.print("toggles="); Serial.println(toggles); }
  }
}
