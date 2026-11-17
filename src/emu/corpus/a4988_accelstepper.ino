// expect: pos=200
// module: {"type":"a4988","pins":{"STEP":"D3","DIR":"D4"},"levels":{"RESET":1,"SLEEP":1}}
// step: {"type":"a4988","steps":200,"pos":200,"rotor":200,"lost":0,"div":1}
// run-ms: 900
// Pilote A4988 et bibliothèque AccelStepper (interface DRIVER) : un tour en pas entiers avec une rampe. Le pilote
// émulé compte chaque front de STEP, dans le sens de DIR ; la rampe garde le moteur accroché (aucun pas perdu).
#include <AccelStepper.h>
AccelStepper moteur(AccelStepper::DRIVER, 3, 4);  // (STEP, DIR)
bool fini = false;
void setup() {
  Serial.begin(9600);
  moteur.setMaxSpeed(1000);
  moteur.setAcceleration(4000);
  moteur.moveTo(200);
}
void loop() {
  moteur.run();
  if (!fini && moteur.distanceToGo() == 0) {
    fini = true;
    Serial.print("pos=");
    Serial.println(moteur.currentPosition());
  }
}
