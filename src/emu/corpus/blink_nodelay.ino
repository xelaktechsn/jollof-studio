// expect: toggles=10
// run-ms: 1100
// Clignotement sans delay() : millis() décide, la boucle reste libre (exemple BlinkWithoutDelay).
const int LED = 13;
unsigned long last = 0;
int toggles = 0;
bool reported = false;
void setup() { Serial.begin(9600); pinMode(LED, OUTPUT); }
void loop() {
  unsigned long now = millis();
  if (now - last >= 100) { last = now; digitalWrite(LED, !digitalRead(LED)); toggles++; }
  if (!reported && now >= 1050) { reported = true; Serial.print("toggles="); Serial.println(toggles); }
}
