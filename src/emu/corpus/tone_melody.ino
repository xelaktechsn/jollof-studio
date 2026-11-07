// expect: notes=8 total=1600ms
// run-ms: 2000
// Mélodie avec tone() (timer 2) et noTone() sur D8 ; la durée totale est mesurée avec millis().
const int NOTES[] = { 262, 294, 330, 349, 392, 440, 494, 523 };
void setup() {
  Serial.begin(9600);
  unsigned long t0 = millis();
  int n = 0;
  for (int f : NOTES) { tone(8, f); delay(200); n++; }
  noTone(8);
  unsigned long dt = millis() - t0;
  Serial.print("notes="); Serial.print(n); Serial.print(" total="); Serial.print((dt + 50) / 100 * 100); Serial.println("ms");
}
void loop() {}
