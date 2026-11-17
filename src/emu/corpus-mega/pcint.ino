// expect: pcint0=6 pcint1=4 pcint2=8
// Interruptions de changement d'état, réglées par registres : PCINT4 (D10, PB4), PCINT9 (D15, PJ0), PCINT16 (A8, PK0).
volatile int c0, c1, c2;
ISR(PCINT0_vect) { c0++; }
ISR(PCINT1_vect) { c1++; }
ISR(PCINT2_vect) { c2++; }
void toggle(byte pin, int k) { for (int i = 0; i < k; i++) { digitalWrite(pin, !digitalRead(pin)); delayMicroseconds(20); } }
void setup() {
  Serial.begin(9600);
  pinMode(10, OUTPUT); pinMode(15, OUTPUT); pinMode(A8, OUTPUT);
  PCMSK0 = _BV(PCINT4); PCMSK1 = _BV(PCINT9); PCMSK2 = _BV(PCINT16);
  PCICR = _BV(PCIE0) | _BV(PCIE1) | _BV(PCIE2);
  toggle(10, 6); toggle(15, 4); toggle(A8, 8);
  Serial.print("pcint0="); Serial.print(c0); Serial.print(" pcint1="); Serial.print(c1); Serial.print(" pcint2="); Serial.println(c2);
}
void loop() {}
