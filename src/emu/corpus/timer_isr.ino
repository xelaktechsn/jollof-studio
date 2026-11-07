// expect: ticks=20
// run-ms: 300
// Interruption du Timer1 programmée à la main : 100 Hz.
volatile unsigned int ticks = 0;
ISR(TIMER1_COMPA_vect) { ticks++; }
void setup() {
  Serial.begin(9600);
  noInterrupts();
  TCCR1A = 0; TCCR1B = 0; TCNT1 = 0;
  OCR1A = 2499;                         // 16 MHz / 64 / 2500 = 100 Hz
  TCCR1B |= _BV(WGM12) | _BV(CS11) | _BV(CS10);
  TIMSK1 |= _BV(OCIE1A);
  interrupts();
}
void loop() {
  static bool done = false;
  if (!done && millis() >= 200) { done = true; noInterrupts(); unsigned int t = ticks; interrupts(); Serial.print("ticks="); Serial.println(t); }
}
