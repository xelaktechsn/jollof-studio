// expect: notes=4 total=800ms
// pin: {"D8":{"freq":[430,450]}}
// run-ms: 1200
// tone() (minuterie 2) : quatre notes mesurées avec millis(), puis un la 440 Hz qui continue.
const int NOTES[] = { 262, 330, 392, 523 };
void setup() {
  Serial.begin(9600);
  unsigned long t0 = millis();
  int n = 0;
  for (int f : NOTES) { tone(8, f); delay(200); n++; }
  noTone(8);
  unsigned long dt = millis() - t0;
  Serial.print("notes="); Serial.print(n); Serial.print(" total="); Serial.print((dt + 50) / 100 * 100); Serial.println("ms");
  tone(8, 440);
}
void loop() {}
