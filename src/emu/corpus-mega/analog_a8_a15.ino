// expect: A0=512 A7=102 A8=204 A15=819 A12=0 ch8=204
// expect: int1v1 A8=930
// input: {"A7":{"v":0.5},"A8":{"v":1.0},"A15":{"v":4.0}}
// Les 16 entrées analogiques : A8 à A15 passent par le bit MUX5 d'ADCSRB. analogRead(8) lit A8 ; référence interne 1,1 V.
void setup() {
  Serial.begin(9600);
  Serial.print("A0="); Serial.print(analogRead(A0));
  Serial.print(" A7="); Serial.print(analogRead(A7));
  Serial.print(" A8="); Serial.print(analogRead(A8));
  Serial.print(" A15="); Serial.print(analogRead(A15));
  Serial.print(" A12="); Serial.print(analogRead(A12));
  Serial.print(" ch8="); Serial.println(analogRead(8));
  analogReference(INTERNAL1V1);
  analogRead(A8);
  Serial.print("int1v1 A8="); Serial.println(analogRead(A8));
}
void loop() {}
