// expect: angle=0 angle=45 angle=90 angle=135 angle=180
// expect: attached=1
// run-ms: 600
// Balayage d'un servo avec la bibliothèque Servo (timer 1) ; read() rend l'angle demandé.
#include <Servo.h>
Servo s;
void setup() {
  Serial.begin(9600);
  s.attach(9);
  Serial.print("attached="); Serial.println(s.attached());
  for (int a = 0; a <= 180; a += 45) { s.write(a); delay(20); Serial.print("angle="); Serial.print(s.read()); Serial.print(' '); }
  Serial.println();
}
void loop() {}
