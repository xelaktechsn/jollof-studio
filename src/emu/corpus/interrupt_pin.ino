// expect: falls=0 level=1
// Interruption externe sur D2 (INPUT_PULLUP, rien de branché : aucun front).
volatile int falls = 0;
void onFall() { falls++; }
void setup() {
  Serial.begin(9600);
  pinMode(2, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(2), onFall, FALLING);
  delay(50);
  Serial.print("falls="); Serial.print(falls); Serial.print(" level="); Serial.println(digitalRead(2));
}
void loop() {}
