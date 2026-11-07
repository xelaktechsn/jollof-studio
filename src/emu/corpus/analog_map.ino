// expect: pct=50
// A0 est à 2,5 V dans le banc de test.
void setup() { Serial.begin(9600); Serial.print("pct="); Serial.println(map(analogRead(A0), 0, 1023, 0, 100)); }
void loop() {}
