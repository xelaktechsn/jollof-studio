// expect: a=12 b=-34 sum=-22
// expect: f=3.75
// send: 12 -34\n3.75\n
// run-ms: 1500
// Lecture de nombres sur le port série avec parseInt() et parseFloat() (délai d'attente de Stream).
void setup() { Serial.begin(9600); Serial.setTimeout(200); }
void loop() {
  static int step = 0;
  if (step == 0 && Serial.available()) {
    long a = Serial.parseInt(), b = Serial.parseInt();
    Serial.print("a="); Serial.print(a); Serial.print(" b="); Serial.print(b); Serial.print(" sum="); Serial.println(a + b);
    step = 1;
  } else if (step == 1 && Serial.available()) {
    float f = Serial.parseFloat();
    Serial.print("f="); Serial.println(f, 2);
    step = 2;
  }
}
