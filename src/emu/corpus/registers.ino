// expect: portb=32
// D13 commandée directement par les registres du port B.
void setup() {
  Serial.begin(9600);
  DDRB |= _BV(5);
  PORTB |= _BV(5);
  Serial.print("portb="); Serial.println(PORTB & _BV(5));
}
void loop() {}
