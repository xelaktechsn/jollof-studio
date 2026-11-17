// expect: attached=1 read=45
// pin: {"D9":{"servo":[42,48]},"D30":{"servo":[133,139]}}
// run-ms: 400
// Bibliothèque Servo sur le Mega : la minuterie 5 sert les 12 premiers servos (D9, D30), les sorties PWM de la
// minuterie 2 (D9, D10) restent libres.
#include <Servo.h>
Servo s, t;
void setup() {
  Serial.begin(9600);
  s.attach(9); t.attach(30);
  s.write(45); t.write(136);
  Serial.print("attached="); Serial.print(s.attached()); Serial.print(" read="); Serial.println(s.read());
}
void loop() {}
