// Fixture de test du mode fidèle (src/emu/avr.test.mjs) : sortie, PWM, série, ADC, entrée avec tirage, tone, servo.
#include <Servo.h>
Servo s;
void setup() {
  Serial.begin(9600);
  pinMode(13, OUTPUT);
  pinMode(2, INPUT_PULLUP);
  s.attach(7);
  s.write(90);
  tone(8, 1000);
}
void loop() {
  digitalWrite(13, HIGH);
  analogWrite(6, 64); // Timer0 : la bibliothèque Servo occupe Timer1 (PWM des broches 9 et 10 désactivée, comme sur la vraie carte)
  Serial.print("A0=");
  Serial.println(analogRead(A0));
  Serial.print("D2=");
  Serial.println(digitalRead(2));
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
