// expect: pos=-3200
// module: {"type":"a4988","pins":{"STEP":"GP2","DIR":"GP3"},"levels":{"RESET":1,"SLEEP":1,"MS1":1,"MS2":1,"MS3":1}}
// step: {"type":"a4988","steps":-3200,"pos":-200,"rotor":-200,"lost":0,"div":16}
// run-ms: 1200
// Pico, A4988 en seizièmes de pas (MS1 à MS3 au niveau haut) et AccelStepper : 3200 micro-pas en arrière, soit un
// tour du moteur (200 pas entiers), avec une rampe.
#include <AccelStepper.h>
AccelStepper moteur(AccelStepper::DRIVER, 2, 3);  // (STEP, DIR)
bool fini = false;
void setup() {
  Serial.begin(115200);
  moteur.setMaxSpeed(8000);
  moteur.setAcceleration(40000);
  moteur.moveTo(-3200);
}
void loop() {
  moteur.run();
  if (!fini && moteur.distanceToGo() == 0) {
    fini = true;
    Serial.print("pos=");
    Serial.println(moteur.currentPosition());
  }
}
