// expect: ECHO:BONJOUR
// send: bonjour\n
// run-ms: 600
void setup() { Serial.begin(9600); }
void loop() {
  if (Serial.available()) {
    String s = Serial.readStringUntil('\n');
    s.toUpperCase();
    Serial.print("ECHO:"); Serial.println(s);
  }
}
