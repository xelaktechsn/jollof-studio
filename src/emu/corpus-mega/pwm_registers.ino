// expect: compc=50
// pin: {"D3":{"pwm":[0.24,0.27]},"D8":{"pwm":[0.74,0.77]}}
// run-ms: 300
// Minuteries de 16 bits réglées à la main : PWM rapide 8 bits sur OC3C (D3, PE5) et OC4C (D8, PH5), et une
// interruption de comparaison C (TIMER5_COMPC_vect, OCIE5C) : 1 kHz en mode CTC (OCR5A), OCR5C au milieu.
volatile unsigned int compc = 0;
ISR(TIMER5_COMPC_vect) { compc++; }
void setup() {
  Serial.begin(9600);
  pinMode(3, OUTPUT); pinMode(8, OUTPUT);
  TCCR3A = _BV(COM3C1) | _BV(WGM30); TCCR3B = _BV(WGM32) | _BV(CS31) | _BV(CS30); OCR3C = 64;
  TCCR4A = _BV(COM4C1) | _BV(WGM40); TCCR4B = _BV(WGM42) | _BV(CS41) | _BV(CS40); OCR4C = 192;
  noInterrupts();
  TCCR5A = 0; TCCR5B = _BV(WGM52) | _BV(CS51) | _BV(CS50); TCNT5 = 0;
  OCR5A = 249; OCR5C = 125;              // 16 MHz / 64 / 250 = 1 kHz
  TIMSK5 = _BV(OCIE5C);
  interrupts();
  delay(50);
  noInterrupts(); unsigned int n = compc; interrupts();
  Serial.print("compc="); Serial.println((n + 2) / 5 * 5);
}
void loop() {}
