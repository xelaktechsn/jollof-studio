// expect: d2=4 d3=3 d18=5 d19=2 d20=6 d21=1
// expect: low=1
// Interruptions externes du Mega : INT4 (D2), INT5 (D3), INT3 (D18), INT2 (D19), INT1 (D20), INT0 (D21). Une broche
// en sortie déclenche aussi son interruption (fiche technique) : le programme crée lui-même les fronts.
volatile int n2, n3, n18, n19, n20, n21;
void i2() { n2++; } void i3() { n3++; } void i18() { n18++; } void i19() { n19++; } void i20() { n20++; } void i21() { n21++; }
void pulses(byte pin, int k) { for (int i = 0; i < k; i++) { digitalWrite(pin, HIGH); delayMicroseconds(50); digitalWrite(pin, LOW); delayMicroseconds(50); } }
void setup() {
  Serial.begin(9600);
  const byte P[] = { 2, 3, 18, 19, 20, 21 };
  for (byte p : P) { pinMode(p, OUTPUT); digitalWrite(p, LOW); }
  attachInterrupt(digitalPinToInterrupt(2), i2, RISING);
  attachInterrupt(digitalPinToInterrupt(3), i3, FALLING);
  attachInterrupt(digitalPinToInterrupt(18), i18, RISING);
  attachInterrupt(digitalPinToInterrupt(19), i19, CHANGE);
  attachInterrupt(digitalPinToInterrupt(20), i20, RISING);
  attachInterrupt(digitalPinToInterrupt(21), i21, FALLING);
  pulses(2, 4); pulses(3, 3); pulses(18, 5); pulses(19, 1); pulses(20, 6); pulses(21, 1);
  Serial.print("d2="); Serial.print(n2); Serial.print(" d3="); Serial.print(n3); Serial.print(" d18="); Serial.print(n18);
  Serial.print(" d19="); Serial.print(n19); Serial.print(" d20="); Serial.print(n20); Serial.print(" d21="); Serial.println(n21);
  detachInterrupt(digitalPinToInterrupt(2));
  pulses(2, 3);
  Serial.print("low="); Serial.println(n2 == 4);
}
void loop() {}
