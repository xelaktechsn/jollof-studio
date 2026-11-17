// expect: pos=200
// expect: leds=ok
// module: {"type":"a4988","pins":{"STEP":"D26","DIR":"D27"},"levels":{"RESET":1,"SLEEP":1}}
// module: {"type":"ws2812","pins":{"DIN":"D25"}}
// px: {"D25":[[255,0,0],[0,255,0],[0,0,255]]}
// step: {"type":"a4988","steps":200,"pos":200,"rotor":[196,200],"lost":[0,2],"div":1}
// run-ms: 12000
// Sur l'ESP32 dans QEMU : pilote A4988 avec AccelStepper (un tour avec rampe, pas cadencés par micros()), barrette
// WS2812 avec Adafruit_NeoPixel (RMT de l'ESP32). Les pas cadencés par micros() dans QEMU gardent un peu d'irrégularité :
// le modèle du moteur peut compter un pas perdu au plus fort de la rampe (sur la vraie carte, aucun).
#include <AccelStepper.h>
#include <Adafruit_NeoPixel.h>
AccelStepper moteur(AccelStepper::DRIVER, 26, 27);
Adafruit_NeoPixel leds(8, 25, NEO_GRB + NEO_KHZ800);
bool fini = false;
void setup() {
  Serial.begin(115200);
  leds.begin();
  leds.setPixelColor(0, leds.Color(255, 0, 0));
  leds.setPixelColor(1, leds.Color(0, 255, 0));
  leds.setPixelColor(2, leds.Color(0, 0, 255));
  leds.show();
  Serial.println("leds=ok");
  moteur.setMaxSpeed(1000);
  moteur.setAcceleration(4000);
  moteur.moveTo(200);
}
void loop() {
  moteur.run();
  if (!fini && moteur.distanceToGo() == 0) { fini = true; Serial.print("pos="); Serial.println(moteur.currentPosition()); }
}
