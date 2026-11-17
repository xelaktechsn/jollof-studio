// expect: I=2.0 A
// expect: P=18.0 W
// input: {"A0":{"v":2.87}}
// run-ms: 300
// Capteur de courant ACS712-05B (185 mV/A, 2,5 V à 0 A) sur A0 : 2,87 V sur la sortie, soit 2 A ; moyenne de 64 lectures
// pour effacer le bruit, puissance d'une charge sous 9 V.
const float SENS = 0.185, ZERO = 2.5;
void setup() {
  Serial.begin(9600);
  long somme = 0;
  for (int i = 0; i < 64; i++) somme += analogRead(A0);
  float tension = somme / 64.0 * 5.0 / 1023.0;
  float courant = (tension - ZERO) / SENS;
  Serial.print("I="); Serial.print(courant, 1); Serial.println(" A");
  Serial.print("P="); Serial.print(courant * 9.0, 1); Serial.println(" W");
}
void loop() {}
