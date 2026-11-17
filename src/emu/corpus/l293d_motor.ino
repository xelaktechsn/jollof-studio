// expect: l293d-ok
// pin: {"D5":{"mode":1,"pwm":[0.78,0.79]},"D7":{"mode":1,"d":1},"D8":{"mode":1,"d":0}}
// Pilote L293D : EN1,2 en PWM (vitesse 200/255), IN1 à HIGH et IN2 à LOW (marche avant). Le calcul du circuit
// (src/sim/dc.js) en tire la tension du moteur ; ici, l'état des broches de la carte émulée.
const int EN12 = 5, IN1 = 7, IN2 = 8;
void setup() {
  Serial.begin(9600);
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  analogWrite(EN12, 200);
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  Serial.println("l293d-ok");
}
void loop() {}
